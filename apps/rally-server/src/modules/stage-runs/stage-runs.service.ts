import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApiErrorCode,
  ChangeAction,
  COUNTDOWN_MS_KEY,
  DEFAULT_COUNTDOWN_MS,
  DEFAULT_JUMP_START_TOLERANCE_MS,
  DEFAULT_MIN_START_GAP_MS,
  JUMP_START_TOLERANCE_MS_KEY,
  MIN_START_GAP_MS_KEY,
  SLOT_PASSING_AFTER_MS,
  SLOT_PASSING_BEFORE_MS,
  StageRunStatus,
  StageScoring,
  StageStatus,
  StartMode,
  type RunSnapshot,
} from '@rally-gate/shared';
import { In, IsNull, MoreThan, Not, Or, Repository } from 'typeorm';
import { apiError } from '../../common/api-error';
import { isUniqueViolation } from '../../common/db-errors';
import { recordChange, runSnapshot } from '../changes/record-change';
import { SettingsService } from '../settings/settings.service';
import { StagesService } from '../stages/stages.service';
import { StageRun } from './stage-run.entity';
import { StageSplit } from './stage-split.entity';

export interface StageRunSplitPair {
  run: StageRun;
  split: StageSplit;
}

export interface StageRunCorrection {
  startTime?: string;
  finishTime?: string | null;
}

export interface ManualStageRunInput {
  entryId: string;
  stageId: string;
  /** Absent means "now" by the server's clock, which the gates sync to. */
  startTime?: string;
  finishTime?: string;
}

export type StageRunWithStatus = StageRun & { status: StageRunStatus };

/** Status is derived, never stored — see the note on `StageRun`. */
export function deriveStageRunStatus(
  run: Pick<StageRun, 'finishTime'> &
    Partial<Pick<StageRun, 'voided' | 'plannedStartTime' | 'startPassingAt'>>,
  stageClosed: boolean,
): StageRunStatus {
  // First: a voided run usually does have a finishTime, and FINISHED would
  // present a struck-out time as a result.
  if (run.voided) {
    return StageRunStatus.VOIDED;
  }
  if (run.finishTime) {
    return StageRunStatus.FINISHED;
  }
  if (!stageClosed) {
    return StageRunStatus.STARTED;
  }
  return run.plannedStartTime && !run.startPassingAt
    ? StageRunStatus.DID_NOT_START
    : StageRunStatus.CANCELLED;
}

/** Whether a slot stage's start passing at `at` can belong to this slot. */
function isNearSlot(slot: Date, at: Date, afterMs: number): boolean {
  const offset = at.getTime() - slot.getTime();
  return offset >= -SLOT_PASSING_BEFORE_MS && offset <= afterMs;
}

/**
 * Collapses a set of runs to the one that counts per entry+stage.
 *
 * A stage that gets red-flagged is re-run, and both attempts are kept — the
 * earlier one is evidence, not garbage — so only a non-voided run counts. On
 * a counted stage the unique index leaves one; on a shakedown every run
 * survives and the fastest finished one is the result, an open one only
 * while there is none. Every query feeding classification passes through
 * here rather than leaving each caller to remember.
 */
export function countingRuns(runs: StageRun[]): StageRun[] {
  const counting = new Map<string, StageRun>();
  for (const run of runs) {
    // Every attempt voided means no result at all — the correct reading of
    // "that run didn't happen".
    if (run.voided) {
      continue;
    }
    const key = `${run.entryId}:${run.stageId}`;
    const seen = counting.get(key);
    if (
      !seen ||
      (run.durationMs != null &&
        (seen.durationMs == null || run.durationMs < seen.durationMs))
    ) {
      counting.set(key, run);
    }
  }
  return [...counting.values()];
}

/** Non-voided runs per entry, the open one included. */
export function runCounts(runs: StageRun[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (!run.voided) {
      counts.set(run.entryId, (counts.get(run.entryId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * A finish must be strictly after its start. Nothing downstream re-checks
 * this: `ClassificationService.rank` sorts `durationMs` ascending, so a
 * negative duration doesn't surface as an error — it takes first place. The
 * two ways it happens are both routine rather than exotic: the finish gate's
 * clock trailing the start gate's (the two are separate Pis, see CLAUDE.md
 * "Timing correctness"), and a mistyped manual correction.
 */
function isValidRunDuration(startTime: Date, finishTime: Date): boolean {
  return finishTime.getTime() > startTime.getTime();
}

/** Callers check `isValidRunDuration` first. */
function durationMs(startTime: Date, finishTime?: Date | null): number | null {
  return finishTime ? finishTime.getTime() - startTime.getTime() : null;
}

/** Throwing form of {@link isValidRunDuration}, for the admin HTTP paths. */
function assertValidRunDuration(startTime: Date, finishTime: Date): void {
  if (!isValidRunDuration(startTime, finishTime)) {
    throw new BadRequestException(
      apiError(
        ApiErrorCode.FINISH_NOT_AFTER_START,
        `finishTime (${finishTime.toISOString()}) must be after startTime (${startTime.toISOString()})`,
      ),
    );
  }
}

/**
 * An Invalid Date has a NaN getTime() rather than throwing, so unparseable
 * input reaching here would propagate into durationMs. See `dto.ts` for why
 * the pipe's `@IsISO8601` isn't the only check.
 */
function parseTime(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      apiError(
        ApiErrorCode.INVALID_TIME,
        `${field} is not a valid date/time: ${value}`,
      ),
    );
  }
  return parsed;
}

@Injectable()
export class StageRunsService {
  private readonly logger = new Logger(StageRunsService.name);

  constructor(
    @InjectRepository(StageRun)
    private readonly stageRuns: Repository<StageRun>,
    @InjectRepository(StageSplit)
    private readonly stageSplits: Repository<StageSplit>,
    private readonly stagesService: StagesService,
    private readonly emitter: EventEmitter2,
    private readonly settings: SettingsService,
  ) {}

  /** Serialises countdowns, so two at once can't take the same slot. */
  private countdownQueue: Promise<unknown> = Promise.resolve();

  /** For the stage marshal check, before anything is changed. */
  async stageIdOf(id: string): Promise<string> {
    return (await this.findOneOrFail(id)).stageId;
  }

  private async findOneOrFail(id: string): Promise<StageRun> {
    const run = await this.stageRuns.findOneBy({ id });
    if (!run) {
      throw new NotFoundException(
        apiError(ApiErrorCode.STAGE_RUN_NOT_FOUND, `StageRun ${id} not found`),
      );
    }
    return run;
  }

  private async isStageClosed(stageId: string): Promise<boolean> {
    const stage = await this.stagesService.findOne(stageId);
    return stage?.status === StageStatus.CLOSED;
  }

  private async withStatus(run: StageRun): Promise<StageRunWithStatus> {
    return { ...run, status: await this.deriveStatus(run) };
  }

  private async deriveStatus(run: StageRun): Promise<StageRunStatus> {
    return deriveStageRunStatus(run, await this.isStageClosed(run.stageId));
  }

  async findAll(stageId?: string): Promise<StageRunWithStatus[]> {
    const runs = await this.stageRuns.find({
      where: stageId ? { stageId } : {},
      order: { startTime: 'DESC' },
    });
    const stages = await this.stagesService.findAll();
    const closedStageIds = new Set(
      stages.filter((s) => s.status === StageStatus.CLOSED).map((s) => s.id),
    );
    return runs.map((run) => ({
      ...run,
      status: deriveStageRunStatus(run, closedStageIds.has(run.stageId)),
    }));
  }

  // The finders below feed results, so each returns only the run that
  // counts per entry+stage. `findAll` deliberately does not — the
  // dashboard shows every attempt, including superseded ones.

  async findFinishedByStage(stageId: string): Promise<StageRun[]> {
    const runs = await this.stageRuns.find({
      where: { stageId, finishTime: Not(IsNull()) },
    });
    return countingRuns(runs).sort(
      (a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0),
    );
  }

  async findByStage(stageId: string): Promise<StageRun[]> {
    return countingRuns(await this.stageRuns.find({ where: { stageId } }));
  }

  async findAllFinished(): Promise<StageRun[]> {
    return countingRuns(
      await this.stageRuns.find({ where: { finishTime: Not(IsNull()) } }),
    );
  }

  /** Runs each entry drove on the stage, for a shakedown's results. */
  async countRunsByStage(stageId: string): Promise<Map<string, number>> {
    return runCounts(await this.stageRuns.find({ where: { stageId } }));
  }

  /**
   * The entry's in-progress attempt on this stage, if any. Voided runs are
   * excluded throughout: voiding is what releases an entry to run again, so
   * a voided row must stop counting as either "already running" or "already
   * finished" everywhere the rule engine checks.
   */
  private findActive(
    entryId: string,
    stageId: string,
  ): Promise<StageRun | null> {
    return this.stageRuns.findOneBy({
      entryId,
      stageId,
      finishTime: IsNull(),
      voided: false,
    });
  }

  /** Whether the entry has any attempt on this stage, open or finished. */
  hasRun(entryId: string, stageId: string): Promise<boolean> {
    return this.stageRuns.existsBy({ entryId, stageId, voided: false });
  }

  /** The entry's last completed run on this stage, if any. */
  private findFinished(
    entryId: string,
    stageId: string,
  ): Promise<StageRun | null> {
    return this.stageRuns.findOne({
      where: { entryId, stageId, finishTime: Not(IsNull()), voided: false },
      order: { finishTime: 'DESC' },
    });
  }

  /** Every attempt of these entries on any stage. */
  findByEntries(entryIds: string[]): Promise<StageRun[]> {
    return this.stageRuns.find({ where: { entryId: In(entryIds) } });
  }

  /** A shakedown is run as often as a car likes; every run counts. */
  private async isShakedown(stageId: string): Promise<boolean> {
    const stage = await this.stagesService.findOne(stageId);
    return stage?.scoring === StageScoring.NONE;
  }

  /**
   * Next attempt number for this entry on this stage. Taken from the
   * highest existing attempt rather than a count, so deleting a phantom run
   * can't hand a later attempt a number that's already in use.
   */
  private async nextAttempt(entryId: string, stageId: string): Promise<number> {
    const highest = await this.stageRuns.findOne({
      where: { entryId, stageId },
      order: { attempt: 'DESC' },
    });
    return (highest?.attempt ?? 0) + 1;
  }

  async startRun(
    entryId: string,
    stageId: string,
    startTime: Date,
  ): Promise<StageRunWithStatus> {
    const existing = await this.findActive(entryId, stageId);
    if (existing) {
      this.logger.warn(
        `Entry ${entryId} already has a running stage run on ${stageId}, ignoring duplicate start`,
      );
      return this.withStatus(existing);
    }
    const finished = await this.findFinished(entryId, stageId);
    const shakedown = await this.isShakedown(stageId);
    if (
      finished &&
      shakedown &&
      startTime.getTime() <= finished.finishTime!.getTime()
    ) {
      // A start from before the last finish is a late passing of a run
      // already timed, not a new one; runs never overlap.
      this.logger.warn(
        `Start ${startTime.toISOString()} for entry ${entryId} on shakedown ${stageId} is not after its last finish, ignoring it`,
      );
      return this.withStatus(finished);
    }
    if (finished && !shakedown) {
      // Re-runs are supported, but a gate detection must not be what starts
      // one. The start gate stays live for the rest of the field while a
      // finished car is recovered back past it, so treating any post-finish
      // start as a new attempt would routinely manufacture a phantom run —
      // and since results count the *latest* attempt, that phantom would
      // silently replace a real time. A re-run is therefore an explicit
      // marshal action (`POST /stage-runs`); the finish gate then completes
      // it on its own, because `findActive` picks up the new open run.
      this.logger.warn(
        `Entry ${entryId} already finished stage ${stageId}, ignoring restart (create a re-run explicitly if the stage was red-flagged)`,
      );
      return this.withStatus(finished);
    }
    const attempt = await this.nextAttempt(entryId, stageId);
    const run = this.stageRuns.create({
      entryId,
      stageId,
      startTime,
      attempt,
      run: shakedown ? attempt : 1,
    });
    try {
      return this.withStatus(await this.stageRuns.save(run));
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
      // Lost a race with a concurrent detection for the same passing — the
      // partial unique index (one non-voided attempt per entry and stage)
      // catches it, since both callers can clear `findActive` first.
      const raced =
        (await this.findActive(entryId, stageId)) ??
        (await this.findFinished(entryId, stageId));
      return this.withStatus(raced!);
    }
  }

  async finishRun(
    entryId: string,
    stageId: string,
    finishTime: Date,
    manual = false,
  ): Promise<StageRunWithStatus | null> {
    const run = await this.findActive(entryId, stageId);
    if (!run) {
      this.logger.warn(
        `No active stage run for entry ${entryId} on ${stageId}, ignoring finish event`,
      );
      return null;
    }
    if (!isValidRunDuration(run.startTime, finishTime)) {
      // Log and ignore, like the duplicate-start/out-of-order cases above —
      // a bad detection shouldn't error out the MQTT pipeline. A burst of
      // these means the finish gate's clock is behind the start gate's.
      this.logger.warn(
        `Finish ${finishTime.toISOString()} is not after start ${run.startTime.toISOString()} for entry ${entryId} on ${stageId} (check gate clock sync), ignoring finish event`,
      );
      return null;
    }
    run.finishTime = finishTime;
    run.finishManual = manual;
    run.durationMs = durationMs(run.startTime, finishTime);
    return this.withStatus(await this.stageRuns.save(run));
  }

  /**
   * A combined start/finish gate: the passing finishes the open run, or
   * starts one. Within `minDurationMs` of the start it is ignored: the same
   * passing reported twice, or the car pulling away after Start now. Decided
   * by arrival order, so a passing that arrives after a later one (a retry,
   * a passing assigned late) is misread; a marshal corrects that.
   */
  async startOrFinishRun(
    entryId: string,
    stageId: string,
    at: Date,
    minDurationMs: number,
  ): Promise<StageRunWithStatus | null> {
    const open = await this.findActive(entryId, stageId);
    if (!open) {
      return this.startRun(entryId, stageId, at);
    }
    if (at.getTime() - open.startTime.getTime() < minDurationMs) {
      this.logger.warn(
        `Passing for entry ${entryId} on ${stageId} is within ${minDurationMs} ms of its start, ignoring it as the same passing`,
      );
      return null;
    }
    return this.finishRun(entryId, stageId, at);
  }

  /**
   * The Countdown button (`SLOT_MANUAL`): a run whose start time is its
   * slot, server clock, queued behind the stage's latest slot. Refuses a car
   * already queued or on stage, or finished on a counted stage (void first
   * for a re-run); on a shakedown it is the car's next run.
   */
  startCountdown(
    entryId: string,
    stageId: string,
    by: string | null,
  ): Promise<StageRunWithStatus> {
    return this.enqueue(() =>
      this.queueSlot(entryId, stageId, by, false),
    ) as Promise<StageRunWithStatus>;
  }

  /**
   * A pre-start gate's trigger: as the button, but null for a car already
   * queued or on stage, stored and ignored, since a loop reads a car near it
   * many times. Recorded with no device: the server acted.
   */
  triggerCountdown(
    entryId: string,
    stageId: string,
  ): Promise<StageRunWithStatus | null> {
    return this.enqueue(() => this.queueSlot(entryId, stageId, null, true));
  }

  private enqueue<T>(slot: () => Promise<T>): Promise<T> {
    const next = this.countdownQueue.then(slot);
    this.countdownQueue = next.catch(() => undefined);
    return next;
  }

  private async queueSlot(
    entryId: string,
    stageId: string,
    by: string | null,
    ignoreBusy: boolean,
  ): Promise<StageRunWithStatus | null> {
    const stage = await this.stagesService.findOneOrFail(stageId);
    if (stage.status !== StageStatus.ACTIVE) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.STAGE_NOT_ACTIVE,
          `Stage ${stageId} is ${stage.status}; countdowns run only on an active stage`,
          { stage: stageId },
        ),
      );
    }
    if (stage.startMode !== StartMode.SLOT_MANUAL) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.NOT_MANUAL_START,
          `Stage ${stageId} doesn't start by countdown`,
          { stage: stageId },
        ),
      );
    }
    const shakedown = stage.scoring === StageScoring.NONE;
    const busy =
      (await this.findActive(entryId, stageId)) ??
      (shakedown ? null : await this.findFinished(entryId, stageId));
    if (busy) {
      if (ignoreBusy) {
        this.logger.log(
          `Entry ${entryId} is already queued, on stage or finished on ${stageId}, ignoring its pre-start detection`,
        );
        return null;
      }
      throw this.alreadyStarting(entryId, stageId);
    }
    const countdownMs = await this.settings.getNumber(
      COUNTDOWN_MS_KEY,
      DEFAULT_COUNTDOWN_MS,
    );
    const gapMs = await this.settings.getNumber(
      MIN_START_GAP_MS_KEY,
      DEFAULT_MIN_START_GAP_MS,
    );
    // Voided slots too: the line was taken at that time either way.
    const latest = await this.stageRuns.findOne({
      where: { stageId, plannedStartTime: Not(IsNull()) },
      order: { plannedStartTime: 'DESC' },
    });
    const slot = new Date(
      Math.max(
        Date.now() + countdownMs,
        (latest?.plannedStartTime?.getTime() ?? 0) + gapMs,
      ),
    );
    const attempt = await this.nextAttempt(entryId, stageId);
    const run = this.stageRuns.create({
      entryId,
      stageId,
      attempt,
      run: shakedown ? attempt : 1,
      startTime: slot,
      plannedStartTime: slot,
    });
    let saved: StageRun;
    try {
      saved = await this.saveRecorded(
        run,
        by,
        ChangeAction.COUNTDOWN_STARTED,
        null,
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        if (ignoreBusy) return null;
        throw this.alreadyStarting(entryId, stageId);
      }
      throw err;
    }
    const withStatus = await this.withStatus(saved);
    this.emitter.emit('stage-run.updated', withStatus);
    return withStatus;
  }

  private alreadyStarting(entryId: string, stageId: string) {
    return new ConflictException(
      apiError(
        ApiErrorCode.ENTRY_ALREADY_STARTING,
        `Entry ${entryId} is already queued, on stage or finished on ${stageId}`,
      ),
    );
  }

  /**
   * Deletes a slot until its car's first start passing; from then on the
   * slot is its start time. Recorded: it was a countdown people saw.
   */
  async cancelCountdown(id: string, by: string | null): Promise<void> {
    const run = await this.findOneOrFail(id);
    if (
      !run.plannedStartTime ||
      run.startPassingAt ||
      run.finishTime ||
      run.voided
    ) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.COUNTDOWN_NOT_CANCELLABLE,
          `StageRun ${id} has no countdown left to cancel`,
        ),
      );
    }
    await this.deleteRecorded(run, by, ChangeAction.COUNTDOWN_CANCELLED);
  }

  /** The marshal ruled a jump start needs no penalty; the mark stays. */
  async dismissJumpStart(
    id: string,
    by: string | null,
  ): Promise<StageRunWithStatus> {
    const run = await this.findOneOrFail(id);
    const toleranceMs = await this.settings.getNumber(
      JUMP_START_TOLERANCE_MS_KEY,
      DEFAULT_JUMP_START_TOLERANCE_MS,
    );
    if (
      !run.plannedStartTime ||
      !run.startPassingAt ||
      run.startPassingAt.getTime() >=
        run.plannedStartTime.getTime() - toleranceMs
    ) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.NO_JUMP_START,
          `StageRun ${id} has no jump start`,
        ),
      );
    }
    const before = runSnapshot(run);
    run.jumpStartDismissed = true;
    const withStatus = await this.withStatus(
      await this.saveRecorded(
        run,
        by,
        ChangeAction.JUMP_START_DISMISSED,
        before,
      ),
    );
    this.emitter.emit('stage-run.updated', withStatus);
    return withStatus;
  }

  /**
   * The non-voided slot run a start passing at `at` belongs to, within slot
   * −10 s to slot + `afterMs`: the car's nearest, or for a light barrier
   * (`entryId` absent) any car's (`docs/event-model.md` "Start slots").
   */
  async findSlotNear(
    stageId: string,
    at: Date,
    afterMs: number,
    entryId?: string,
  ): Promise<StageRun | null> {
    const near = (
      await this.stageRuns.find({
        where: {
          stageId,
          voided: false,
          plannedStartTime: Not(IsNull()),
          ...(entryId ? { entryId } : {}),
        },
      })
    ).filter((run) => isNearSlot(run.plannedStartTime!, at, afterMs));
    const slotMs = (run: StageRun) => run.plannedStartTime!.getTime();
    if (!entryId) {
      // A car that stalls leaves closer to the next slot than to its own, so
      // a begun slot still waiting for its passing comes first. The latest
      // one: a no-show must not take the next car's passing, and so on down
      // the queue. Never a jump start, being after its slot.
      const toleranceMs = await this.settings.getNumber(
        JUMP_START_TOLERANCE_MS_KEY,
        DEFAULT_JUMP_START_TOLERANCE_MS,
      );
      const begun = near
        .filter(
          (run) =>
            !run.startPassingAt && slotMs(run) - toleranceMs <= at.getTime(),
        )
        .sort((a, b) => slotMs(b) - slotMs(a))[0];
      if (begun) return begun;
    }
    const distance = (run: StageRun) => Math.abs(at.getTime() - slotMs(run));
    return near.sort((a, b) => distance(a) - distance(b))[0] ?? null;
  }

  /**
   * A start passing on a slot stage sets no time, only the evidence for the
   * jump-start mark. The earliest counts, so a repeat or the car breaking
   * the beam again changes nothing. Null when it is near none of the car's
   * slots, or changed nothing.
   */
  async recordStartPassing(
    entryId: string,
    stageId: string,
    at: Date,
    afterMs = SLOT_PASSING_AFTER_MS,
  ): Promise<StageRunWithStatus | null> {
    const run = await this.findSlotNear(stageId, at, afterMs, entryId);
    if (!run) {
      this.logger.warn(
        `Start passing ${at.toISOString()} for entry ${entryId} on ${stageId} is near none of its slots, ignoring it`,
      );
      return null;
    }
    // Conditional, so two passings processed at once keep the earlier one.
    const { affected } = await this.stageRuns.update(
      { id: run.id, startPassingAt: Or(IsNull(), MoreThan(at)) },
      { startPassingAt: at },
    );
    if (!affected) {
      return null;
    }
    return this.withStatus({ ...run, startPassingAt: at });
  }

  /**
   * A combined start/finish gate on a slot stage: before slot +
   * `minDurationMs` a passing is the start passing, the first after it the
   * finish. A run without a slot (typed in by hand) goes the gate way.
   */
  async slotStartOrFinish(
    entryId: string,
    stageId: string,
    at: Date,
    minDurationMs: number,
  ): Promise<StageRunWithStatus | null> {
    const open = await this.findActive(entryId, stageId);
    if (open && !open.plannedStartTime) {
      return this.startOrFinishRun(entryId, stageId, at, minDurationMs);
    }
    if (
      open?.plannedStartTime &&
      at.getTime() >= open.plannedStartTime.getTime() + minDurationMs
    ) {
      return this.finishRun(entryId, stageId, at);
    }
    return this.recordStartPassing(
      entryId,
      stageId,
      at,
      Math.min(SLOT_PASSING_AFTER_MS, minDurationMs),
    );
  }

  async recordSplit(
    entryId: string,
    stageId: string,
    gateId: string,
    splitIndex: number,
    at: Date,
  ): Promise<StageSplit | null> {
    const run = await this.findActive(entryId, stageId);
    if (!run) {
      this.logger.warn(
        `No active stage run for entry ${entryId} on ${stageId}, ignoring split event`,
      );
      return null;
    }
    if (at.getTime() <= run.startTime.getTime()) {
      // A negative elapsed time would lead the split ranking: a skewed
      // clock, or a car passing a split before its slot.
      this.logger.warn(
        `Split ${at.toISOString()} is not after start ${run.startTime.toISOString()} for entry ${entryId} on ${stageId}, ignoring it`,
      );
      return null;
    }
    const existing = await this.stageSplits.findOneBy({
      stageRunId: run.id,
      gateId,
    });
    if (existing) {
      this.logger.warn(
        `Split for gate ${gateId} already recorded for run ${run.id}, ignoring duplicate`,
      );
      return existing;
    }
    const split = this.stageSplits.create({
      stageRunId: run.id,
      gateId,
      splitIndex,
      timestamp: at,
      elapsedMs: at.getTime() - run.startTime.getTime(),
    });
    return this.stageSplits.save(split);
  }

  /** Admin override: fix a run's timing when a gate detection was missed or wrong. */
  async correctRun(
    id: string,
    patch: StageRunCorrection,
    by: string | null,
  ): Promise<StageRunWithStatus> {
    const run = await this.findOneOrFail(id);
    const before = runSnapshot(run);
    if (patch.startTime !== undefined) {
      run.startTime = parseTime(patch.startTime, 'startTime');
      run.startManual = true;
    }
    if (patch.finishTime !== undefined) {
      run.finishTime = patch.finishTime
        ? parseTime(patch.finishTime, 'finishTime')
        : null;
      run.finishManual = !!run.finishTime;
    }
    // Checked against the merged result, not the patch: correcting only one
    // of the two still has to leave the pair ordered.
    if (run.finishTime) {
      assertValidRunDuration(run.startTime, run.finishTime);
    }
    run.durationMs = durationMs(run.startTime, run.finishTime);
    const saved = await this.saveRecorded(
      run,
      by,
      ChangeAction.RUN_CORRECTED,
      before,
    );
    const withStatus = await this.withStatus(saved);
    this.emitter.emit('stage-run.updated', withStatus);
    return withStatus;
  }

  /** Admin override: record a run whose start (and maybe finish) detection never arrived. */
  async createManual(
    input: ManualStageRunInput,
    by: string | null,
  ): Promise<StageRunWithStatus> {
    const startTime = input.startTime
      ? parseTime(input.startTime, 'startTime')
      : new Date();
    const finishTime = input.finishTime
      ? parseTime(input.finishTime, 'finishTime')
      : null;
    if (finishTime) {
      assertValidRunDuration(startTime, finishTime);
    }
    const attempt = await this.nextAttempt(input.entryId, input.stageId);
    const run = this.stageRuns.create({
      entryId: input.entryId,
      stageId: input.stageId,
      attempt,
      run: (await this.isShakedown(input.stageId)) ? attempt : 1,
      startTime,
      finishTime,
      startManual: true,
      finishManual: !!finishTime,
      durationMs: durationMs(startTime, finishTime),
    });
    let saved: StageRun;
    try {
      saved = await this.saveRecorded(run, by, ChangeAction.RUN_CREATED, null);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // An entry has at most one non-voided attempt per stage. Recording
        // a re-run by hand therefore means voiding the previous attempt
        // first — the same act that frees the car for a gate-timed re-run.
        throw new ConflictException(
          apiError(
            ApiErrorCode.ATTEMPT_ALREADY_COUNTS,
            `Entry ${input.entryId} already has an attempt on stage ${input.stageId} that counts; void it first to record another`,
          ),
        );
      }
      throw err;
    }
    const withStatus = await this.withStatus(saved);
    this.emitter.emit('stage-run.updated', withStatus);
    return withStatus;
  }

  /**
   * "Finish now": a hand-timed finish stamped with the server clock, the
   * fallback when the finish gate misses a car. Unlike a gate finish it
   * refuses instead of ignoring, so a double click can't move a time.
   */
  async finishNow(id: string, by: string | null): Promise<StageRunWithStatus> {
    const run = await this.findOneOrFail(id);
    if (
      run.voided ||
      run.finishTime ||
      (await this.isStageClosed(run.stageId))
    ) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.RUN_NOT_FINISHABLE,
          `StageRun ${id} is ${run.voided ? 'voided' : run.finishTime ? 'already finished' : 'on a closed stage'}`,
        ),
      );
    }
    const finishTime = new Date();
    if (!isValidRunDuration(run.startTime, finishTime)) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.RUN_STARTS_IN_FUTURE,
          `StageRun ${id} starts after now; correct its start first`,
        ),
      );
    }
    const before = runSnapshot(run);
    run.finishTime = finishTime;
    run.finishManual = true;
    run.durationMs = durationMs(run.startTime, finishTime);
    const finished = await this.withStatus(
      await this.saveRecorded(run, by, ChangeAction.RUN_FINISHED, before),
    );
    this.emitter.emit('stage-run.updated', finished);
    return finished;
  }

  /**
   * Strikes out an attempt — the red-flag action. The row stays: it is the
   * record of what was originally timed, which is exactly what a protest
   * would turn on, so this is deliberately not a delete.
   *
   * Once voided the entry has no active and no finished attempt on the
   * stage, so the *start gate* opens the re-run by itself on the car's next
   * pass. That is the point of doing it this way rather than hand-entering a
   * replacement run: both ends of the re-run stay gate-timed.
   */
  async voidRun(id: string, by: string | null): Promise<StageRunWithStatus> {
    const run = await this.findOneOrFail(id);
    run.voided = true;
    const withStatus = await this.withStatus(
      await this.saveRecorded(run, by, ChangeAction.RUN_VOIDED, null),
    );
    this.emitter.emit('stage-run.updated', withStatus);
    return withStatus;
  }

  /**
   * Reverses a void. Allowed exactly when no other attempt survives in its
   * place: the same `run`, or, both open, the entry's one open run. Refuses
   * rather than cascading: striking out a run the car actually drove is the
   * marshal's call to make explicitly, not a side effect of "restore".
   */
  async unvoidRun(id: string, by: string | null): Promise<StageRunWithStatus> {
    const run = await this.findOneOrFail(id);
    const survivor = (
      await this.stageRuns.find({
        where: {
          entryId: run.entryId,
          stageId: run.stageId,
          voided: false,
        },
      })
    ).find(
      (other) =>
        other.id !== run.id &&
        (other.run === run.run || (!other.finishTime && !run.finishTime)),
    );

    if (survivor) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.OTHER_ATTEMPT_COUNTS,
          `Attempt ${survivor.attempt} already counts for this stage; void it first if attempt ${run.attempt} should count instead`,
          { blockingAttempt: survivor.attempt, attempt: run.attempt },
        ),
      );
    }

    run.voided = false;
    const withStatus = await this.withStatus(
      await this.saveRecorded(run, by, ChangeAction.RUN_RESTORED, null),
    );
    this.emitter.emit('stage-run.updated', withStatus);
    return withStatus;
  }

  async remove(id: string, by: string | null): Promise<void> {
    await this.deleteRecorded(
      await this.findOneOrFail(id),
      by,
      ChangeAction.RUN_DELETED,
    );
  }

  private async deleteRecorded(
    run: StageRun,
    by: string | null,
    action: ChangeAction,
  ): Promise<void> {
    await this.stageRuns.manager.transaction(async (manager) => {
      // No foreign keys, so splits don't cascade and have to go first.
      await manager.delete(StageSplit, { stageRunId: run.id });
      await manager.delete(StageRun, run.id);
      await recordChange(manager, by, {
        action,
        entryId: run.entryId,
        stageId: run.stageId,
        subjectId: run.id,
        before: runSnapshot(run),
      });
    });
    this.emitter.emit('stage-run.deleted', {
      id: run.id,
      stageId: run.stageId,
    });
  }

  /** A hand-made change and its `ChangeRecord`, in one transaction. */
  private saveRecorded(
    run: StageRun,
    by: string | null,
    action: ChangeAction,
    before: RunSnapshot | null,
  ): Promise<StageRun> {
    return this.stageRuns.manager.transaction(async (manager) => {
      const saved = await manager.save(StageRun, run);
      await recordChange(manager, by, {
        action,
        entryId: saved.entryId,
        stageId: saved.stageId,
        subjectId: saved.id,
        before,
        after: runSnapshot(saved),
      });
      return saved;
    });
  }

  async findSplitsForStage(stageId: string): Promise<StageSplit[]> {
    const runs = await this.stageRuns.find({
      where: { stageId },
      select: { id: true },
    });
    if (runs.length === 0) {
      return [];
    }
    return this.stageSplits.find({
      where: { stageRunId: In(runs.map((run) => run.id)) },
      order: { splitIndex: 'ASC' },
    });
  }

  async findSplitsForStageAtIndex(
    stageId: string,
    splitIndex: number,
  ): Promise<StageRunSplitPair[]> {
    // Through findByStage, not a direct query: that is what applies
    // `countingRuns`, so a voided attempt's splits stop appearing on the
    // live split leaderboard.
    const runs = await this.findByStage(stageId);
    const stageClosed = await this.isStageClosed(stageId);
    const activeRuns = runs.filter(
      (run) =>
        deriveStageRunStatus(run, stageClosed) !== StageRunStatus.CANCELLED,
    );
    if (activeRuns.length === 0) {
      return [];
    }
    const runIds = activeRuns.map((run) => run.id);
    const splits = await this.stageSplits.find({
      where: { stageRunId: In(runIds), splitIndex },
    });
    const runById = new Map(activeRuns.map((run) => [run.id, run]));
    // Dropping unmatched splits rather than asserting non-null: a pair with
    // no run would reach `getSplitClassification`, which reads `pair.run`.
    return splits.flatMap((split) => {
      const run = runById.get(split.stageRunId);
      return run ? [{ run, split }] : [];
    });
  }
}
