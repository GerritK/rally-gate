import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { StageStatus } from '@rally-gate/shared';
import { Repository } from 'typeorm';
import { StageRunsService } from '../stage-runs/stage-runs.service';
import { Stage } from './stage.entity';

@Injectable()
export class StagesService {
  constructor(
    @InjectRepository(Stage)
    private readonly stages: Repository<Stage>,
    private readonly stageRunsService: StageRunsService,
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

  async close(id: string): Promise<Stage> {
    const stage = await this.findOne(id);
    if (!stage) {
      throw new NotFoundException(`Stage ${id} not found`);
    }
    await this.stageRunsService.cancelActiveRuns(id);
    stage.status = StageStatus.CLOSED;
    return this.stages.save(stage);
  }
}
