import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CreateEventDto, OpenEventDto } from './dto';
import { EventFilesService } from './event-files.service';

@Controller('event')
export class EventFilesController {
  constructor(private readonly eventFilesService: EventFilesService) {}

  @Get()
  info() {
    return this.eventFilesService.info();
  }

  /** Both switch by restarting the server; the client polls `GET /event`. */
  @Post()
  @HttpCode(202)
  create(@Body() body: CreateEventDto) {
    return this.eventFilesService.create(body);
  }

  @Post('open')
  @HttpCode(202)
  open(@Body() body: OpenEventDto) {
    return this.eventFilesService.open(body.file);
  }
}
