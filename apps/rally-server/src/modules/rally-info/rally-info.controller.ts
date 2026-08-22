import { Body, Controller, Get, Put } from '@nestjs/common';
import { RallyInfo } from './rally-info.entity';
import { RallyInfoService } from './rally-info.service';

@Controller('rally-info')
export class RallyInfoController {
  constructor(private readonly rallyInfoService: RallyInfoService) {}

  @Get()
  get() {
    return this.rallyInfoService.get();
  }

  @Put()
  upsert(@Body() body: Omit<RallyInfo, 'id'>) {
    return this.rallyInfoService.upsert(body);
  }
}
