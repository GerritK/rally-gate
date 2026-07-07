import { Controller, Get, Param } from '@nestjs/common';
import { StageRunsService } from './stage-runs.service';

@Controller('stage-runs')
export class StageRunsController {
  constructor(private readonly stageRunsService: StageRunsService) {}

  @Get()
  findAll() {
    return this.stageRunsService.findAll();
  }

  @Get(':id/splits')
  findSplits(@Param('id') id: string) {
    return this.stageRunsService.findSplitsForRun(id);
  }
}
