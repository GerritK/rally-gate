import { Module } from '@nestjs/common';
import { GatesModule } from '../gates/gates.module';
import { PenaltiesModule } from '../penalties/penalties.module';
import { SettingsModule } from '../settings/settings.module';
import { StageRunsModule } from '../stage-runs/stage-runs.module';
import { StagesModule } from '../stages/stages.module';
import { EntriesModule } from '../entries/entries.module';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';

@Module({
  imports: [
    StageRunsModule,
    StagesModule,
    EntriesModule,
    GatesModule,
    SettingsModule,
    PenaltiesModule,
  ],
  controllers: [ClassificationController],
  providers: [ClassificationService],
  exports: [ClassificationService],
})
export class ClassificationModule {}
