import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GatesModule } from '../gates/gates.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { StageRunsModule } from '../stage-runs/stage-runs.module';
import { DetectionEventRecord } from './detection-event.entity';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DetectionEventRecord]),
    GatesModule,
    VehiclesModule,
    StageRunsModule,
  ],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
