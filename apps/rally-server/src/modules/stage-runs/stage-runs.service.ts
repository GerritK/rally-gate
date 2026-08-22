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
  run: Pick<StageRun, 'finishTime'>,
  stageClosed: boolean,
): StageRunStatus {
  if (run.finishTime) {
    return StageRunStatus.FINISHED;
  }
  return stageClosed ? StageRunStatus.CANCELLED : StageRunStatus.STARTED;
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

  findFinishedByStage(stageId: string): Promise<StageRun[]> {
    return this.stageRuns.find({
      where: { stageId, finishTime: Not(IsNull()) },
      order: { durationMs: 'ASC' },
    });
  }

  findByStage(stageId: string): Promise<StageRun[]> {
    return this.stageRuns.find({ where: { stageId } });
  }

  findAllFinished(): Promise<StageRun[]> {
    return this.stageRuns.find({ where: { finishTime: Not(IsNull()) } });
  }

  /** The vehicle's in-progress attempt on this stage, if any (not yet finished). */
  private findActive(
    vehicleId: string,
    stageId: string,
  ): Promise<StageRun | null> {
    return this.stageRuns.findOneBy({
      vehicleId,
      stageId,
      finishTime: IsNull(),
    });
  }

  private findFinished(
    vehicleId: string,
    stageId: string,
  ): Promise<StageRun | null> {
    return this.stageRuns.findOneBy({
      vehicleId,
      stageId,
      finishTime: Not(IsNull()),
    });
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
      this.logger.warn(
        `Vehicle ${vehicleId} already finished stage ${stageId}, ignoring restart`,
      );
      return this.withStatus(finished);
    }
    const run = this.stageRuns.create({ vehicleId, stageId, startTime });
    try {
      return this.withStatus(await this.stageRuns.save(run));
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
      // Lost a race with another detection for the same vehicle+stage.
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
        throw new ConflictException(
          `Vehicle ${input.vehicleId} already has a run on stage ${input.stageId}`,
        );
      }
      throw err;
    }
    const withStatus = await this.withStatus(saved);
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
