import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AssignEntryDto, RecentEventsQueryDto } from './dto';
import { EventsService } from './events.service';
import { AccessRole, RallyStatus } from '@rally-gate/shared';
import { CurrentPrincipal, Roles } from '../auth/auth.guard';
import { assertMayChangeStage, type Principal } from '../auth/auth.service';
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
  @Roles(AccessRole.TIMING)
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
  @Roles(AccessRole.TIMING, AccessRole.STAGE_MARSHAL)
  @Post(':eventId/assign')
  async assign(
    @Param('eventId') eventId: string,
    @Body() body: AssignEntryDto,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertMayChangeStage(
      principal,
      await this.eventsService.stageIdOfAwaiting(eventId),
    );
    return this.eventsService.assignEntry(eventId, body.entryId);
  }

  @Roles(AccessRole.TIMING, AccessRole.STAGE_MARSHAL)
  @Post(':eventId/dismiss')
  async dismiss(
    @Param('eventId') eventId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertMayChangeStage(
      principal,
      await this.eventsService.stageIdOfAwaiting(eventId),
    );
    return this.eventsService.dismissAwaiting(eventId);
  }
}
