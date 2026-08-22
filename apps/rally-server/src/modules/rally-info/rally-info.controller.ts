import { Body, Controller, Get, Put } from '@nestjs/common';
import { UpsertRallyInfoDto } from './dto';
import { RallyInfoService } from './rally-info.service';

@Controller('rally-info')
export class RallyInfoController {
  constructor(private readonly rallyInfoService: RallyInfoService) {}

  @Get()
  get() {
    return this.rallyInfoService.get();
  }

  @Put()
  upsert(@Body() body: UpsertRallyInfoDto) {
    return this.rallyInfoService.upsert(body);
  }
}
