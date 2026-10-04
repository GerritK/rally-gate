import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StagesModule } from '../stages/stages.module';
import { EntriesModule } from '../entries/entries.module';
import { StageRun } from './stage-run.entity';
import { StageRunsController } from './stage-runs.controller';
import { StageRunsService } from './stage-runs.service';
import { StageSplit } from './stage-split.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([StageRun, StageSplit]),
    StagesModule,
    EntriesModule,
  ],
  controllers: [StageRunsController],
  providers: [StageRunsService],
  exports: [StageRunsService],
})
export class StageRunsModule {}
