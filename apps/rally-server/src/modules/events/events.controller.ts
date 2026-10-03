import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AssignVehicleDto, RecentEventsQueryDto } from './dto';
import { EventsService } from './events.service';

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
  @Post('pending/retry')
  async retryPending() {
    return { recovered: await this.eventsService.reprocessPending() };
  }

  /** Passings a gate saw but couldn't identify, e.g. a light barrier. */
  @Get('awaiting-vehicle')
  findAwaitingVehicle() {
    return this.eventsService.findAwaitingVehicle();
  }

  @Post(':eventId/assign')
  assign(@Param('eventId') eventId: string, @Body() body: AssignVehicleDto) {
    return this.eventsService.assignVehicle(eventId, body.vehicleId);
  }

  @Post(':eventId/dismiss')
  dismiss(@Param('eventId') eventId: string) {
    return this.eventsService.dismissAwaiting(eventId);
  }
}
