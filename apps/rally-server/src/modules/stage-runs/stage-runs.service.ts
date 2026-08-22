import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StageRunStatus, StageStatus } from '@rally-gate/shared';
import { In, IsNull, Not, Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/db-errors';
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
  vehicleId: string;
  stageId: string;
  startTime: string;
  finishTime?: string;
}

export type StageRunWithStatus = StageRun & { status: StageRunStatus };

/**
 * STARTED/FINISHED/CANCELLED is derived, never stored: a run is FINISHED once
 * it has a finishTime, otherwise it's STARTED unless its stage has been
 * closed (marshal swept it as DNF), in which case it's CANCELLED.
 */
export function deriveStageRunStatus(
  run: Pick<StageRun, 'finishTime'> & Partial<Pick<StageRun, 'voided'>>,
  stageClosed: boolean,
): StageRunStatus {
  // Checked first: a voided run may well have a finishTime, and reporting it
  // as FINISHED would present a struck-out time as a result.
  if (run.voided) {
    return StageRunStatus.VOIDED;
  }
  if (run.finishTime) {
    return StageRunStatus.FINISHED;
  }
  return stageClosed ? StageRunStatus.CANCELLED : StageRunStatus.STARTED;
}

/**
 * Collapses a set of runs to the most recent attempt per vehicle+stage.
 *
 * A stage that gets red-flagged is re-run, and both attempts are kept — the
 * earlier one is evidence, not garbage. Results only ever count the latest,
 * so every query feeding classification passes through here rather than
 * leaving each caller to remember.
 */
export function latestAttempts(runs: StageRun[]): StageRun[] {
  const latest = new Map<string, StageRun>();
  for (const run of runs) {
    // A voided attempt counts for nothing, so results fall back to the last
    // surviving attempt — or to no result at all if every attempt is voided,
    // which is the correct reading of "that run didn't happen".
    if (run.voided) {
      continue;
    }
    const key = `${run.vehicleId}:${run.stageId}`;
    const seen = latest.get(key);
    if (!seen || run.attempt > seen.attempt) {
      latest.set(key, run);
    }
  }
  return [...latest.values()];
}

/**
 * A finish must be strictly after its start. Nothing downstream re-checks
 * this: `ClassificationService.rank` sorts `durationMs` ascending, so a
 * negative duration doesn't surface as an error — it takes first place. The
 * two ways it happens are both routine rather than exotic: the finish gate's
 * clock trailing the start gate's (the two are separate Pis, see CLAUDE.md
 * "Timing correctness"), and a mistyped manual correction.
 */
export function isValidRunDuration(startTime: Date, finishTime: Date): boolean {
  return finishTime.getTime() > startTime.getTime();
}

/** Throwing form of {@link isValidRunDuration}, for the admin HTTP paths. */
function assertValidRunDuration(startTime: Date, finishTime: Date): void {
  if (!isValidRunDuration(startTime, finishTime)) {
    throw new BadRequestException(
      `finishTime (${finishTime.toISOString()}) must be after startTime (${startTime.toISOString()})`,
    );
  }
}

/**
 * Corrections arrive as raw strings from an unvalidated body (there's no
 * ValidationPipe yet — see CLAUDE.md "Requests are untrusted"), and
 * `new Date('nonsense')` is an Invalid Date whose getTime() is NaN rather
 * than a throw. Unchecked, that NaN propagates into durationMs.
 */
function parseTime(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      `${field} is not a valid date/time: ${value}`,
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
  ) {}

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

  async findAll(): Promise<StageRunWithStatus[]> {
    const runs = await this.stageRuns.find({ order: { startTime: 'DESC' } });
    const stages = await this.stagesService.findAll();
    const closedStageIds = new Set(
      stages.filter((s) => s.status === StageStatus.CLOSED).map((s) => s.id),
    );
    return runs.map((run) => ({
      ...run,
      status: deriveStageRunStatus(run, closedStageIds.has(run.stageId)),
    }));
  }

  // The three finders below feed results, so each returns only the latest
  // attempt per vehicle+stage. `findAll` deliberately does not — the
  // dashboard shows every attempt, including superseded ones.

  async findFinishedByStage(stageId: string): Promise<StageRun[]> {
    const runs = await this.stageRuns.find({
      where: { stageId, finishTime: Not(IsNull()) },
    });
    return latestAttempts(runs).sort(
      (a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0),
    );
  }

  async findByStage(stageId: string): Promise<StageRun[]> {
    return latestAttempts(await this.stageRuns.find({ where: { stageId } }));
  }

  async findAllFinished(): Promise<StageRun[]> {
    return latestAttempts(
      await this.stageRuns.find({ where: { finishTime: Not(IsNull()) } }),
    );
  }

  /**
   * The vehicle's in-progress attempt on this stage, if any. Voided runs are
   * excluded throughout: voiding is what releases a vehicle to run again, so
   * a voided row must stop counting as either "already running" or "already
   * finished" everywhere the rule engine checks.
   */
  private findActive(
    vehicleId: string,
    stageId: string,
  ): Promise<StageRun | null> {
    return this.stageRuns.findOneBy({
      vehicleId,
      stageId,
      finishTime: IsNull(),
      voided: false,
    });
  }

  /** The vehicle's most recent completed attempt on this stage, if any. */
  private findFinished(
    vehicleId: string,
    stageId: string,
  ): Promise<StageRun | null> {
    return this.stageRuns.findOne({
      where: { vehicleId, stageId, finishTime: Not(IsNull()), voided: false },
      order: { attempt: 'DESC' },
    });
  }

  /**
   * Next attempt number for this vehicle on this stage. Taken from the
   * highest existing attempt rather than a count, so deleting a phantom run
   * can't hand a later attempt a number that's already in use.
   */
  private async nextAttempt(
    vehicleId: string,
    stageId: string,
  ): Promise<number> {
    const highest = await this.stageRuns.findOne({
      where: { vehicleId, stageId },
      order: { attempt: 'DESC' },
    });
    return (highest?.attempt ?? 0) + 1;
  }

  async startRun(
    vehicleId: string,
    stageId: string,
    startTime: Date,
  ): Promise<StageRunWithStatus> {
    const existing = await this.findActive(vehicleId, stageId);
    if (existing) {
      this.logger.warn(
        `Vehicle ${vehicleId} already has a running stage run on ${stageId}, ignoring duplicate start`,
      );
      return this.withStatus(existing);
    }
    const finished = await this.findFinished(vehicleId, stageId);
    if (finished) {
      // Re-runs are supported, but a gate detection must not be what starts
      // one. The start gate stays live for the rest of the field while a
      // finished car is recovered back past it, so treating any post-finish
      // start as a new attempt would routinely manufacture a phantom run —
      // and since results count the *latest* attempt, that phantom would
      // silently replace a real time. A re-run is therefore an explicit
      // marshal action (`POST /stage-runs`); the finish gate then completes
      // it on its own, because `findActive` picks up the new open run.
      this.logger.warn(
        `Vehicle ${vehicleId} already finished stage ${stageId}, ignoring restart (create a re-run explicitly if the stage was red-flagged)`,
      );
      return this.withStatus(finished);
    }
    const run = this.stageRuns.create({
      vehicleId,
      stageId,
      startTime,
      attempt: await this.nextAttempt(vehicleId, stageId),
    });
    try {
      return this.withStatus(await this.stageRuns.save(run));
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
      // Lost a race with a concurrent detection for the same passing — the
      // partial unique index on (vehicleId, stageId) where finishTime IS NULL
      // is what catches it, since both callers can clear `findActive` first.
      const raced =
        (await this.findActive(vehicleId, stageId)) ??
        (await this.findFinished(vehicleId, stageId));
      return this.withStatus(raced!);
    }
  }

  async finishRun(
    vehicleId: string,
    stageId: string,
    finishTime: Date,
  ): Promise<StageRunWithStatus | null> {
    const run = await this.findActive(vehicleId, stageId);
    if (!run) {
      this.logger.warn(
        `No active stage run for vehicle ${vehicleId} on ${stageId}, ignoring finish event`,
      );
      return null;
    }
    if (!isValidRunDuration(run.startTime, finishTime)) {
      // Log and ignore, like the duplicate-start/out-of-order cases above —
      // a bad detection shouldn't error out the MQTT pipeline. A burst of
      // these means the finish gate's clock is behind the start gate's.
      this.logger.warn(
        `Finish ${finishTime.toISOString()} is not after start ${run.startTime.toISOString()} for vehicle ${vehicleId} on ${stageId} (check gate clock sync), ignoring finish event`,
      );
      return null;
    }
    run.finishTime = finishTime;
    run.durationMs = finishTime.getTime() - run.startTime.getTime();
    return this.withStatus(await this.stageRuns.save(run));
  }

  async recordSplit(
    vehicleId: string,
    stageId: string,
    gateId: string,
    splitIndex: number,
    at: Date,
  ): Promise<StageSplit | null> {
    const run = await this.findActive(vehicleId, stageId);
    if (!run) {
      this.logger.warn(
        `No active stage run for vehicle ${vehicleId} on ${stageId}, ignoring split event`,
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
  ): Promise<StageRunWithStatus> {
    const run = await this.stageRuns.findOneBy({ id });
    if (!run) {
      throw new NotFoundException(`StageRun ${id} not found`);
    }
    if (patch.startTime !== undefined) {
      run.startTime = parseTime(patch.startTime, 'startTime');
    }
    if (patch.finishTime !== undefined) {
      run.finishTime = patch.finishTime
        ? parseTime(patch.finishTime, 'finishTime')
        : null;
    }
    // Checked against the merged result, not the patch: correcting only one
    // of the two still has to leave the pair ordered.
    if (run.finishTime) {
      assertValidRunDuration(run.startTime, run.finishTime);
    }
    run.durationMs = run.finishTime
      ? run.finishTime.getTime() - run.startTime.getTime()
      : null;
    const saved = await this.stageRuns.save(run);
    const withStatus = await this.withStatus(saved);
    this.emitter.emit('stage-run.updated', withStatus);
    return withStatus;
  }

  /** Admin override: record a run whose start (and maybe finish) detection never arrived. */
  async createManual(input: ManualStageRunInput): Promise<StageRunWithStatus> {
    const startTime = parseTime(input.startTime, 'startTime');
    const finishTime = input.finishTime
      ? parseTime(input.finishTime, 'finishTime')
      : null;
    if (finishTime) {
      assertValidRunDuration(startTime, finishTime);
    }
    const run = this.stageRuns.create({
      vehicleId: input.vehicleId,
      stageId: input.stageId,
      attempt: await this.nextAttempt(input.vehicleId, input.stageId),
      startTime,
      finishTime,
      durationMs: finishTime
        ? finishTime.getTime() - startTime.getTime()
        : null,
    });
    let saved: StageRun;
    try {
      saved = await this.stageRuns.save(run);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Only an *unfinished* run collides now — completed attempts are
        // allowed to accumulate, that's what makes a re-run possible.
        throw new ConflictException(
          `Vehicle ${input.vehicleId} already has an unfinished run on stage ${input.stageId}; finish or delete it before starting another attempt`,
        );
      }
      throw err;
    }
    const withStatus = await this.withStatus(saved);
    this.emitter.emit('stage-run.updated', withStatus);
    return withStatus;
  }

  /**
   * Strikes out an attempt — the red-flag action. The row stays: it is the
   * record of what was originally timed, which is exactly what a protest
   * would turn on, so this is deliberately not a delete.
   *
   * Once voided the vehicle has no active and no finished attempt on the
   * stage, so the *start gate* opens the re-run by itself on the car's next
   * pass. That is the point of doing it this way rather than hand-entering a
   * replacement run: both ends of the re-run stay gate-timed.
   */
  async voidRun(id: string): Promise<StageRunWithStatus> {
    const run = await this.stageRuns.findOneBy({ id });
    if (!run) {
      throw new NotFoundException(`StageRun ${id} not found`);
    }
    run.voided = true;
    const withStatus = await this.withStatus(await this.stageRuns.save(run));
    this.emitter.emit('stage-run.updated', withStatus);
    return withStatus;
  }

  /**
   * Reverses a void — for a red flag called on the wrong car, or called and
   * then withdrawn.
   *
   * Deliberately refuses rather than cascading. Voiding the later attempts
   * automatically would strike out a run the car actually drove, as a side
   * effect of a button labelled "unvoid"; the marshal should say so
   * explicitly. Two states are rejected:
   *
   * - a later surviving attempt already supersedes this one, so unvoiding
   *   would restore nothing — `latestAttempts` takes the highest, and a
   *   control that silently does nothing is worse than one that refuses;
   * - it would leave two open attempts, which the partial unique index
   *   forbids. Reachable by voiding two unfinished attempts and unvoiding
   *   them in order, so the check can't be left to the index alone — it
   *   would surface as a driver error rather than an explanation.
   *
   * And it warns, once, when restoring would *displace* the attempt that
   * currently counts — void 1 and 2, restore 1, then restore 2, and the
   * result silently moves back to 2. That is a coherent thing to want, so
   * `force` confirms it rather than forbidding it, the same shape as the
   * gate conflict in `activateForStage`. Unlike the two refusals above it is
   * forceable, because there is something real to confirm.
   */
  async unvoidRun(id: string, force = false): Promise<StageRunWithStatus> {
    const run = await this.stageRuns.findOneBy({ id });
    if (!run) {
      throw new NotFoundException(`StageRun ${id} not found`);
    }
    const siblings = (
      await this.stageRuns.find({
        where: {
          vehicleId: run.vehicleId,
          stageId: run.stageId,
          voided: false,
        },
      })
    ).filter((other) => other.id !== run.id);

    const superseding = siblings.find((other) => other.attempt > run.attempt);
    if (superseding) {
      throw new ConflictException(
        `Attempt ${superseding.attempt} supersedes this one, so restoring it would change nothing — void attempt ${superseding.attempt} first if this attempt should count`,
      );
    }
    if (!run.finishTime && siblings.some((other) => !other.finishTime)) {
      throw new ConflictException(
        `Another attempt on this stage is still open; only one attempt can be in progress at a time`,
      );
    }

    // Past the check above, every surviving sibling is numbered below this
    // one, so restoring it takes over as the counting attempt. The highest
    // of them is the one being displaced.
    const displaced = siblings.reduce<StageRun | null>(
      (highest, other) =>
        !highest || other.attempt > highest.attempt ? other : highest,
      null,
    );
    if (displaced && !force) {
      throw new ConflictException({
        message: `Attempt ${displaced.attempt} currently counts for this stage; restoring attempt ${run.attempt} replaces it as the counting run`,
        displacedAttempt: displaced.attempt,
      });
    }

    run.voided = false;
    const withStatus = await this.withStatus(await this.stageRuns.save(run));
    this.emitter.emit('stage-run.updated', withStatus);
    return withStatus;
  }

  async remove(id: string): Promise<void> {
    const result = await this.stageRuns.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`StageRun ${id} not found`);
    }
  }

  findSplitsForRun(stageRunId: string): Promise<StageSplit[]> {
    return this.stageSplits.find({
      where: { stageRunId },
      order: { splitIndex: 'ASC' },
    });
  }

  async findSplitsForStageAtIndex(
    stageId: string,
    splitIndex: number,
  ): Promise<StageRunSplitPair[]> {
    const runs = await this.stageRuns.find({ where: { stageId } });
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
    return splits.map((split) => ({
      run: runById.get(split.stageRunId)!,
      split,
    }));
  }
}
