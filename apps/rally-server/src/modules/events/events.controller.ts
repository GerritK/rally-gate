import { Controller, Get, Post } from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  findRecent() {
    return this.eventsService.findRecent();
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
}
