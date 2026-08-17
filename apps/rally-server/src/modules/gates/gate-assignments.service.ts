import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { GateRole } from '@rally-gate/shared';
import { Repository } from 'typeorm';
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

  create(data: { gateId: string; stageId: string; role: GateRole; splitIndex?: number }): Promise<GateAssignment> {
    const assignment = this.assignments.create({ ...data, active: false });
    return this.assignments.save(assignment);
  }

  async activate(id: string): Promise<GateAssignment> {
    const assignment = await this.assignments.findOneBy({ id });
    if (!assignment) {
      throw new NotFoundException(`GateAssignment ${id} not found`);
    }
    await this.assignments.manager.transaction(async (manager) => {
      await manager.update(GateAssignment, { gateId: assignment.gateId, active: true }, { active: false });
      await manager.update(GateAssignment, { id }, { active: true });
    });
    return this.assignments.findOneBy({ id }) as Promise<GateAssignment>;
  }

  async deactivate(id: string): Promise<GateAssignment> {
    await this.assignments.update({ id }, { active: false });
    return this.assignments.findOneBy({ id }) as Promise<GateAssignment>;
  }

  async remove(id: string): Promise<void> {
    await this.assignments.delete(id);
  }
}
