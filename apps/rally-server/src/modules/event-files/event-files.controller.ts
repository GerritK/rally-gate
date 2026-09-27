import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { CreateEventDto, OpenEventDto } from './dto';
import { EventFilesService } from './event-files.service';
import { KnownHardwareService } from './known-hardware.service';

@Controller('event')
export class EventFilesController {
  constructor(
    private readonly eventFilesService: EventFilesService,
    private readonly knownHardware: KnownHardwareService,
  ) {}

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

  @Get('known-gates')
  knownGates() {
    return this.knownHardware.list();
  }

  /** This computer forgets the gate; the open event keeps it. */
  @Delete('known-gates/:id')
  forgetGate(@Param('id') id: string) {
    this.knownHardware.forget(id);
  }
}
