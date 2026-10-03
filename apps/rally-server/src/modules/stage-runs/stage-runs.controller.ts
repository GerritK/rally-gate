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

  /** Every attempt, voided ones included; `?stageId=` narrows to one stage. */
  @Get()
  findAll(@Query('stageId') stageId?: string) {
    return this.stageRunsService.findAll(stageId);
  }

  /** All splits of every attempt on a stage, so a page needs one request. */
  @Get('splits')
  findSplitsForStage(@Query('stageId') stageId: string) {
    return this.stageRunsService.findSplitsForStage(stageId);
  }

  @Post()
  create(@Body() body: CreateStageRunDto) {
    return this.stageRunsService.createManual(body);
  }

  @Patch(':id')
  correct(@Param('id') id: string, @Body() body: CorrectStageRunDto) {
    return this.stageRunsService.correctRun(id, body);
  }

  /** Hand-timed finish, server-stamped. 409 if finished, voided or closed. */
  @Post(':id/finish')
  finishNow(@Param('id') id: string) {
    return this.stageRunsService.finishNow(id);
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
