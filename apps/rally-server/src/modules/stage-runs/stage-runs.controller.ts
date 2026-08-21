import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { StageRunsService } from './stage-runs.service';
import type {
  ManualStageRunInput,
  StageRunCorrection,
} from './stage-runs.service';

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

  @Post()
  create(@Body() body: ManualStageRunInput) {
    return this.stageRunsService.createManual(body);
  }

  @Patch(':id')
  correct(@Param('id') id: string, @Body() body: StageRunCorrection) {
    return this.stageRunsService.correctRun(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stageRunsService.remove(id);
  }
}
