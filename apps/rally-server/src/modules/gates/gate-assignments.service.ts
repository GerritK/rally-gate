import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { GateRole } from '@rally-gate/shared';
import { In, Not, Repository } from 'typeorm';
import { GateAssignment } from './gate-assignment.entity';

@Injectable()
export class GateAssignmentsService {
  constructor(
    @InjectRepository(GateAssignment)
    private readonly assignments: Repository<GateAssignment>,
  ) {}

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

  create(data: {
    gateId: string;
    stageId: string;
    role: GateRole;
    splitIndex?: number;
  }): Promise<GateAssignment> {
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

  async remove(id: string): Promise<void> {
    await this.assignments.delete(id);
  }
}
