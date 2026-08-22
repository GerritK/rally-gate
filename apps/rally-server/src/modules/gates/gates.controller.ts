import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { Gate } from './gate.entity';
import { GatesService } from './gates.service';

@Controller('gates')
export class GatesController {
  constructor(private readonly gatesService: GatesService) {}

  @Get()
  findAll() {
    return this.gatesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.gatesService.findOne(id);
  }

  @Put(':id')
  upsert(@Param('id') id: string, @Body() gate: Omit<Gate, 'id'>) {
    return this.gatesService.upsert({ ...gate, id });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.gatesService.remove(id);
  }
}
