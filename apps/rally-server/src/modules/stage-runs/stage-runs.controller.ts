import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
   * Reverses a void. Refuses outright if a later surviving attempt would
   * still supersede this one (void that one first), or if it would leave two
   * attempts open. 409s with `{ displacedAttempt }` — retryable with
   * `?force=true` — when restoring would take over as the counting attempt
   * from another surviving one.
   */
  @Post(':id/unvoid')
  unvoid(@Param('id') id: string, @Query('force') force?: string) {
    return this.stageRunsService.unvoidRun(id, force === 'true');
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stageRunsService.remove(id);
  }
}
