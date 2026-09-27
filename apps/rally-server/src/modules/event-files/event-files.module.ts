import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stage } from '../stages/stage.entity';
import { EventFilesController } from './event-files.controller';
import { EventFilesService } from './event-files.service';

@Module({
  imports: [TypeOrmModule.forFeature([Stage])],
  controllers: [EventFilesController],
  providers: [EventFilesService],
})
export class EventFilesModule {}
