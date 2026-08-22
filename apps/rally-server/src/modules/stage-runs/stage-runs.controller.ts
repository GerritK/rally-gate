import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CorrectStageRunDto, CreateStageRunDto } from './dto';
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

  @Post()
  create(@Body() body: CreateStageRunDto) {
    return this.stageRunsService.createManual(body);
  }

  @Patch(':id')
  correct(@Param('id') id: string, @Body() body: CorrectStageRunDto) {
    return this.stageRunsService.correctRun(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stageRunsService.remove(id);
  }
}
