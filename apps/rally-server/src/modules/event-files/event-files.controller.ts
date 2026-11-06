import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { rmSync } from 'node:fs';
import { Private } from '../auth/auth.guard';
import { CreateEventDto, ImportEventDto, OpenEventDto } from './dto';
import { EventFilesService } from './event-files.service';
import { KnownHardwareService } from './known-hardware.service';

/** Also the lobby's (`LobbyModule`), so it needs no event open. */
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

  /** Organiser only, like every change: a file is the whole event. */
  @Post('import')
  importEvent(@Query() query: ImportEventDto, @Req() req: Request) {
    return this.eventFilesService.importEvent(
      req,
      query.file,
      query.replace === 'true',
    );
  }

  @Private()
  @Get(':file/download')
  async download(@Param('file') file: string, @Res() res: Response) {
    const snapshot = await this.eventFilesService.snapshot(file);
    res.download(snapshot, file, () => rmSync(snapshot, { force: true }));
  }

  @Delete(':file')
  @HttpCode(204)
  delete(@Param('file') file: string) {
    this.eventFilesService.delete(file);
  }
}

@Controller('event/known-gates')
export class KnownGatesController {
  constructor(private readonly knownHardware: KnownHardwareService) {}

  @Get()
  knownGates() {
    return this.knownHardware.list();
  }

  /** This computer forgets the gate; the open event keeps it. */
  @Delete(':id')
  forgetGate(@Param('id') id: string) {
    this.knownHardware.forget(id);
  }
}
