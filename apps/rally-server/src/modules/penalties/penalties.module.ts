import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntriesModule } from '../entries/entries.module';
import { StagesModule } from '../stages/stages.module';
import {
  PenaltiesController,
  PenaltyTypesController,
} from './penalties.controller';
import { PenaltiesService } from './penalties.service';
import { PenaltyType } from './penalty-type.entity';
import { Penalty } from './penalty.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Penalty, PenaltyType]),
    EntriesModule,
    StagesModule,
  ],
  controllers: [PenaltyTypesController, PenaltiesController],
  providers: [PenaltiesService],
  exports: [PenaltiesService],
})
export class PenaltiesModule {}
