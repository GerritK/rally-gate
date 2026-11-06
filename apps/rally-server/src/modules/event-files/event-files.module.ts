import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gate } from '../gates/gate.entity';
import { Stage } from '../stages/stage.entity';
import {
  EventFilesController,
  KnownGatesController,
} from './event-files.controller';
import { EventFilesService } from './event-files.service';
import { KnownHardwareService } from './known-hardware.service';

@Module({
  imports: [TypeOrmModule.forFeature([Stage, Gate])],
  controllers: [EventFilesController, KnownGatesController],
  providers: [EventFilesService, KnownHardwareService],
})
export class EventFilesModule {}
