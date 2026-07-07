import { Module } from '@nestjs/common';
import { StageRunsModule } from '../stage-runs/stage-runs.module';
import { StagesModule } from '../stages/stages.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';

@Module({
  imports: [StageRunsModule, StagesModule, VehiclesModule],
  controllers: [ClassificationController],
  providers: [ClassificationService],
})
export class ClassificationModule {}
