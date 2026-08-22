import { Module } from '@nestjs/common';
import { GatesModule } from '../gates/gates.module';
import { SettingsModule } from '../settings/settings.module';
import { StageRunsModule } from '../stage-runs/stage-runs.module';
import { StagesModule } from '../stages/stages.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';

@Module({
  imports: [
    StageRunsModule,
    StagesModule,
    VehiclesModule,
    GatesModule,
    SettingsModule,
  ],
  controllers: [ClassificationController],
  providers: [ClassificationService],
})
export class ClassificationModule {}
