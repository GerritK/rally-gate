import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { UpsertRallyInfoDto } from './dto';
import { RallyInfoService } from './rally-info.service';
import { RallyStatusService } from './rally-status.service';
import { Public } from '../auth/auth.guard';

@Controller('rally-info')
export class RallyInfoController {
  constructor(
    private readonly rallyInfoService: RallyInfoService,
    private readonly rallyStatusService: RallyStatusService,
  ) {}

  @Public()
  @Get()
  get() {
    return this.rallyInfoService.get();
  }

  @Put()
  upsert(@Body() body: UpsertRallyInfoDto) {
    return this.rallyInfoService.upsert(body);
  }

  @Post('start')
  start() {
    return this.rallyStatusService.start();
  }

  /** 409 with `{ count }` while cars are on stage; closes running stages. */
  @Post('close')
  close() {
    return this.rallyStatusService.close();
  }

  @Post('reopen')
  reopen() {
    return this.rallyStatusService.reopen();
  }
}
