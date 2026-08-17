import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { StageRunStatus } from '@rally-gate/shared';
import { In, Repository } from 'typeorm';
import { Gate } from '../gates/gate.entity';
import { StageRun } from './stage-run.entity';
import { StageSplit } from './stage-split.entity';

export interface StageRunSplitPair {
  run: StageRun;
  split: StageSplit;
}

@Injectable()
export class StageRunsService {
  private readonly logger = new Logger(StageRunsService.name);

  constructor(
    @InjectRepository(StageRun)
    private readonly stageRuns: Repository<StageRun>,
    @InjectRepository(StageSplit)
    private readonly stageSplits: Repository<StageSplit>,
  ) {}

  findAll(): Promise<StageRun[]> {
    return this.stageRuns.find({ order: { startTime: 'DESC' } });
  }

  findFinishedByStage(stageId: string): Promise<StageRun[]> {
    return this.stageRuns.find({
      where: { stageId, status: StageRunStatus.FINISHED },
      order: { durationMs: 'ASC' },
    });
  }

  findByStage(stageId: string): Promise<StageRun[]> {
    return this.stageRuns.find({ where: { stageId } });
  }

  async cancelActiveRuns(stageId: string): Promise<void> {
    await this.stageRuns.update({ stageId, status: StageRunStatus.STARTED }, { status: StageRunStatus.CANCELLED });
  }

  findAllFinished(): Promise<StageRun[]> {
    return this.stageRuns.find({ where: { status: StageRunStatus.FINISHED } });
  }

  private findActive(vehicleId: string, stageId: string): Promise<StageRun | null> {
    return this.stageRuns.findOneBy({
      vehicleId,
      stageId,
      status: StageRunStatus.STARTED,
    });
  }

  private findFinished(vehicleId: string, stageId: string): Promise<StageRun | null> {
    return this.stageRuns.findOneBy({
      vehicleId,
      stageId,
      status: StageRunStatus.FINISHED,
    });
  }

  async startRun(vehicleId: string, stageId: string, startTime: Date): Promise<StageRun> {
    const existing = await this.findActive(vehicleId, stageId);
    if (existing) {
      this.logger.warn(`Vehicle ${vehicleId} already has a running stage run on ${stageId}, ignoring duplicate start`);
      return existing;
    }
    const finished = await this.findFinished(vehicleId, stageId);
    if (finished) {
      this.logger.warn(`Vehicle ${vehicleId} already finished stage ${stageId}, ignoring restart`);
      return finished;
    }
    const run = this.stageRuns.create({
      vehicleId,
      stageId,
      startTime,
      status: StageRunStatus.STARTED,
    });
    return this.stageRuns.save(run);
  }

  async finishRun(vehicleId: string, stageId: string, finishTime: Date): Promise<StageRun | null> {
    const run = await this.findActive(vehicleId, stageId);
    if (!run) {
      this.logger.warn(`No active stage run for vehicle ${vehicleId} on ${stageId}, ignoring finish event`);
      return null;
    }
    run.finishTime = finishTime;
    run.durationMs = finishTime.getTime() - run.startTime.getTime();
    run.status = StageRunStatus.FINISHED;
    return this.stageRuns.save(run);
  }

  async recordSplit(vehicleId: string, stageId: string, gate: Gate, at: Date): Promise<StageSplit | null> {
    const run = await this.findActive(vehicleId, stageId);
    if (!run) {
      this.logger.warn(`No active stage run for vehicle ${vehicleId} on ${stageId}, ignoring split event`);
      return null;
    }
    const existing = await this.stageSplits.findOneBy({ stageRunId: run.id, gateId: gate.id });
    if (existing) {
      this.logger.warn(`Split for gate ${gate.id} already recorded for run ${run.id}, ignoring duplicate`);
      return existing;
    }
    const split = this.stageSplits.create({
      stageRunId: run.id,
      gateId: gate.id,
      splitIndex: gate.splitIndex ?? 0,
      timestamp: at,
      elapsedMs: at.getTime() - run.startTime.getTime(),
    });
    return this.stageSplits.save(split);
  }

  findSplitsForRun(stageRunId: string): Promise<StageSplit[]> {
    return this.stageSplits.find({ where: { stageRunId }, order: { splitIndex: 'ASC' } });
  }

  async findSplitsForStageAtIndex(stageId: string, splitIndex: number): Promise<StageRunSplitPair[]> {
    const runs = await this.stageRuns.find({
      where: { stageId },
    });
    const activeRuns = runs.filter((run) => run.status !== StageRunStatus.CANCELLED);
    if (activeRuns.length === 0) {
      return [];
    }
    const runById = new Map(activeRuns.map((run) => [run.id, run]));
    const splits = await this.stageSplits.find({
      where: { stageRunId: In([...runById.keys()]), splitIndex },
    });
    return splits.map((split) => ({ run: runById.get(split.stageRunId)!, split }));
  }
}
