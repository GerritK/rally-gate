import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { GateRole, StageStatus } from '@rally-gate/shared';
import { In, Not, Repository } from 'typeorm';
import { Stage } from '../stages/stage.entity';
import { GateAssignment } from './gate-assignment.entity';

@Injectable()
export class GateAssignmentsService {
  constructor(
    @InjectRepository(GateAssignment)
    private readonly assignments: Repository<GateAssignment>,
    @InjectRepository(Stage)
    private readonly stages: Repository<Stage>,
  ) {}

  /**
   * Gate assignments are the pre-event plan for a stage — once it's ACTIVE
   * its gates are already live (`StagesService.activate`) and once CLOSED
   * it's terminal history, so the plan shouldn't shift under either. Doesn't
   * guard `activateForStage`/`deactivateForStage`/`removeForStage` — those
   * are internal lifecycle steps driven by `StagesService` itself while the
   * stage's own status is mid-transition.
   */
  private async assertStageEditable(stageId: string): Promise<void> {
    const stage = await this.stages.findOneBy({ id: stageId });
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    if (stage.status !== StageStatus.NOT_STARTED) {
      throw new ConflictException(
        `Stage ${stageId} is ${stage.status} — gate assignments can only be edited while NOT_STARTED`,
      );
    }
  }

  findAll(): Promise<GateAssignment[]> {
    return this.assignments.find();
  }

  findByGate(gateId: string): Promise<GateAssignment[]> {
    return this.assignments.find({ where: { gateId } });
  }

  findActiveForGate(gateId: string): Promise<GateAssignment | null> {
    return this.assignments.findOneBy({ gateId, active: true });
  }

  findActiveSplitGatesForStage(stageId: string): Promise<GateAssignment[]> {
    return this.assignments.find({
      where: { stageId, role: GateRole.STAGE_SPLIT, active: true },
      order: { splitIndex: 'ASC' },
    });
  }

  async create(data: {
    gateId: string;
    stageId: string;
    role: GateRole;
    splitIndex?: number;
  }): Promise<GateAssignment> {
    await this.assertStageEditable(data.stageId);
    const assignment = this.assignments.create({ ...data, active: false });
    return this.assignments.save(assignment);
  }

  /**
   * Other stages whose assignments are currently active on any gate this
   * stage also uses — the set `activateForStage` must warn about before
   * stealing those gates.
   */
  async findConflictingStageIds(stageId: string): Promise<string[]> {
    const mine = await this.assignments.find({ where: { stageId } });
    const gateIds = mine.map((a) => a.gateId);
    if (gateIds.length === 0) return [];
    const conflicting = await this.assignments.find({
      where: { gateId: In(gateIds), active: true, stageId: Not(stageId) },
    });
    return [...new Set(conflicting.map((a) => a.stageId))];
  }

  /**
   * Activates every assignment for this stage (what makes its gates "live").
   * Refuses when another stage is already live on a shared gate unless
   * `force` is set, in which case that other stage's assignments are
   * deactivated first — the caller (`StagesService`) still needs to know
   * which stage(s) that was, so it can bring their `Stage.status` back down
   * out of `ACTIVE` too.
   */
  async activateForStage(
    stageId: string,
    force = false,
  ): Promise<{ deactivatedStageIds: string[] }> {
    const conflictingStageIds = await this.findConflictingStageIds(stageId);
    if (conflictingStageIds.length > 0 && !force) {
      throw new ConflictException({ conflictingStageIds });
    }
    await this.assignments.manager.transaction(async (manager) => {
      if (conflictingStageIds.length > 0) {
        await manager.update(
          GateAssignment,
          { stageId: In(conflictingStageIds) },
          { active: false },
        );
      }
      await manager.update(GateAssignment, { stageId }, { active: true });
    });
    return { deactivatedStageIds: conflictingStageIds };
  }

  async deactivateForStage(stageId: string): Promise<void> {
    await this.assignments.update({ stageId }, { active: false });
  }

  async removeForStage(stageId: string): Promise<void> {
    await this.assignments.delete({ stageId });
  }

  async remove(id: string): Promise<void> {
    const assignment = await this.assignments.findOneBy({ id });
    if (!assignment) return;
    await this.assertStageEditable(assignment.stageId);
    await this.assignments.delete(id);
  }

  /**
   * Deleting a gate cascades to every assignment referencing it. Refuses
   * outright (no `force` override) if any of those belong to an
   * ACTIVE/CLOSED stage — those specific assignments can't be removed
   * (`assertStageEditable`), so the gate can't be fully cleaned up either.
   * Otherwise requires `force` — same "warn once, confirm once" shape as
   * `activateForStage` — since it's a bystander deletion the marshal may
   * not expect.
   */
  async removeAllForGate(gateId: string, force = false): Promise<void> {
    const assignments = await this.assignments.find({ where: { gateId } });
    if (assignments.length === 0) return;

    const stageIds = [...new Set(assignments.map((a) => a.stageId))];
    const stages = await this.stages.find({ where: { id: In(stageIds) } });
    const lockedStageIds = stages
      .filter((s) => s.status !== StageStatus.NOT_STARTED)
      .map((s) => s.id);
    if (lockedStageIds.length > 0) {
      throw new ConflictException(
        `Gate ${gateId} is referenced by ACTIVE/CLOSED stage(s) (${lockedStageIds.join(', ')}) and cannot be deleted`,
      );
    }
    if (!force) {
      throw new ConflictException({
        message: `Gate ${gateId} has ${assignments.length} gate assignment(s) that will also be deleted`,
        assignmentCount: assignments.length,
      });
    }
    await this.assignments.delete({ gateId });
  }
}
