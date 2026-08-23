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

  /**
   * Strikes out an attempt (red flag). Keeps the row as evidence, drops it
   * from results, and frees the vehicle so the start gate can open a re-run
   * on its next pass — see "StageRun" in `docs/event-model.md`.
   */
  @Post(':id/void')
  void(@Param('id') id: string) {
    return this.stageRunsService.voidRun(id);
  }

  /**
   * Reverses a void. 409s with `{ blockingAttempt }` if another attempt
   * already counts for that stage — a vehicle has at most one non-voided
   * attempt, so that one has to be voided first.
   */
  @Post(':id/unvoid')
  unvoid(@Param('id') id: string) {
    return this.stageRunsService.unvoidRun(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stageRunsService.remove(id);
  }
}
