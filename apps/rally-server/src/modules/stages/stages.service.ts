import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { StageStatus } from '@rally-gate/shared';
import { Repository } from 'typeorm';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { Stage } from './stage.entity';

@Injectable()
export class StagesService {
  constructor(
    @InjectRepository(Stage)
    private readonly stages: Repository<Stage>,
    private readonly gateAssignmentsService: GateAssignmentsService,
  ) {}

  findAll(): Promise<Stage[]> {
    return this.stages.find({ order: { stageNumber: 'ASC' } });
  }

  findOne(id: string): Promise<Stage | null> {
    return this.stages.findOneBy({ id });
  }

  async upsert(stage: Stage): Promise<Stage> {
    await this.stages.save(stage);
    return this.findOne(stage.id) as Promise<Stage>;
  }

  /**
   * Closing a stage also deactivates its gates — a closed stage shouldn't
   * keep recording detections against it (`EventsService` only checks
   * `GateAssignment.active`, not `Stage.status`). Any still-unfinished run
   * becomes CANCELLED for free since that status is derived, not stored.
   */
  async close(id: string): Promise<Stage> {
    const stage = await this.findOne(id);
    if (!stage) {
      throw new NotFoundException(`Stage ${id} not found`);
    }
    await this.gateAssignmentsService.deactivateForStage(id);
    stage.status = StageStatus.CLOSED;
    return this.stages.save(stage);
  }

  /**
   * Closing is terminal — a closed stage's gates cannot be reactivated
   * (see `docs/architecture.md` "Gate assignment: plan vs. live"). Fixing a
   * single missed/bad detection uses the stage-run correction endpoints
   * instead of reopening the whole stage. `Stage.status` becomes `ACTIVE`
   * here so it's the single source of truth for stage lifecycle, even
   * though the rule engine still reads per-gate `GateAssignment.active`.
   * When `force` bumps another stage off a shared gate, that stage is
   * closed (not just deactivated) — its gates are gone either way, so
   * anything still `STARTED` on it can never get a real finish detection
   * again; closing marks those DNF instead of leaving them stuck `STARTED`
   * forever (see `close`'s CANCELLED-on-close behavior).
   */
  async activate(id: string, force: boolean): Promise<Stage> {
    const stage = await this.findOne(id);
    if (!stage) {
      throw new NotFoundException(`Stage ${id} not found`);
    }
    if (stage.status === StageStatus.CLOSED) {
      throw new ConflictException(
        `Stage ${id} is closed and cannot be reactivated`,
      );
    }
    const { deactivatedStageIds } =
      await this.gateAssignmentsService.activateForStage(id, force);
    // ponytail: not one transaction — a crash mid-loop can leave a bumped
    // stage's GateAssignment rows deactivated but Stage.status still ACTIVE.
    // Wrap in a manager.transaction() if that's ever seen in practice.
    for (const bumpedStageId of deactivatedStageIds) {
      await this.close(bumpedStageId);
    }
    stage.status = StageStatus.ACTIVE;
    return this.stages.save(stage);
  }
}
