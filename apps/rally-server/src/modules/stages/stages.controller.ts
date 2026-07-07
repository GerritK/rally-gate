import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Stage } from './stage.entity';
import { StagesService } from './stages.service';

@Controller('stages')
export class StagesController {
  constructor(private readonly stagesService: StagesService) {}

  @Get()
  findAll() {
    return this.stagesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stagesService.findOne(id);
  }

  @Put(':id')
  upsert(@Param('id') id: string, @Body() stage: Omit<Stage, 'id'>) {
    return this.stagesService.upsert({ ...stage, id });
  }
}
