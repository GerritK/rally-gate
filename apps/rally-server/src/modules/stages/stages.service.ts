import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Stage } from './stage.entity';

@Injectable()
export class StagesService {
  constructor(
    @InjectRepository(Stage)
    private readonly stages: Repository<Stage>,
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
}
