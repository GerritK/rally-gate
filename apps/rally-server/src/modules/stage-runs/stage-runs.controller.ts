import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ApiErrorCode, isOutOfEvent } from '@rally-gate/shared';
import { apiError } from '../../common/api-error';
import { EntriesService } from '../entries/entries.service';
import { CorrectStageRunDto, CreateStageRunDto } from './dto';
import { StageRunsService } from './stage-runs.service';

@Controller('stage-runs')
export class StageRunsController {
  constructor(
    private readonly stageRunsService: StageRunsService,
    private readonly entriesService: EntriesService,
  ) {}

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

  /** Start now, or a time entered by hand. 409 for a car out of the event:
   *  a gate's passing wouldn't time it either (`EventsService.applyRules`). */
  @Post()
  async create(@Body() body: CreateStageRunDto) {
    const entry = await this.entriesService.findOne(body.entryId);
    if (!entry) {
      throw new NotFoundException(
        apiError(
          ApiErrorCode.ENTRY_NOT_FOUND,
          `Entry ${body.entryId} not found`,
        ),
      );
    }
    if (isOutOfEvent(entry.status)) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.ENTRY_OUT_OF_EVENT,
          `#${entry.startNumber} is ${entry.status.toLowerCase()} and can't start`,
          { startNumber: entry.startNumber },
        ),
      );
    }
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
   * from results, and frees the entry so the start gate can open a re-run
   * on its next pass — see "StageRun" in `docs/event-model.md`.
   */
  @Post(':id/void')
  void(@Param('id') id: string) {
    return this.stageRunsService.voidRun(id);
  }

  /**
   * Reverses a void. 409s with `{ blockingAttempt }` if another attempt
   * already counts for that stage — an entry has at most one non-voided
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
