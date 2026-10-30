import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AssignEntryDto, RecentEventsQueryDto } from './dto';
import { EventsService } from './events.service';
import { RallyStatus } from '@rally-gate/shared';
import { CurrentPrincipal, Requires } from '../auth/auth.guard';
import { assertMay, type Principal } from '../auth/auth.service';
import { LockedWhen } from '../rally-info/rally-lock';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  findRecent(@Query() query: RecentEventsQueryDto) {
    return this.eventsService.findRecent(query.gateId);
  }

  /**
   * Detections stored but never turned into timing, because rule application
   * failed. A non-empty list means passings are missing from the results —
   * the dashboard surfaces the count so it isn't only visible in the logs.
   */
  @Get('pending')
  findPending() {
    return this.eventsService.findPending();
  }

  /** Retry now rather than waiting for the periodic sweep. */
  @Requires('retryPending')
  @Post('pending/retry')
  async retryPending() {
    return { recovered: await this.eventsService.reprocessPending() };
  }

  /** Passings a gate saw but couldn't identify, e.g. a light barrier. */
  @Get('awaiting-entry')
  findAwaitingEntry() {
    return this.eventsService.findAwaitingEntry();
  }

  @LockedWhen(RallyStatus.CLOSED)
  @Requires('assignPassing')
  @Post(':eventId/assign')
  async assign(
    @Param('eventId') eventId: string,
    @Body() body: AssignEntryDto,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertMay(
      principal,
      'assignPassing',
      await this.eventsService.stageIdOfAwaiting(eventId),
    );
    return this.eventsService.assignEntry(eventId, body.entryId);
  }

  @Requires('assignPassing')
  @Post(':eventId/dismiss')
  async dismiss(
    @Param('eventId') eventId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertMay(
      principal,
      'assignPassing',
      await this.eventsService.stageIdOfAwaiting(eventId),
    );
    return this.eventsService.dismissAwaiting(eventId);
  }
}
