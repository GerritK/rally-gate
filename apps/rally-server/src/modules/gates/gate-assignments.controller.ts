import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CreateGateAssignmentDto } from './dto';
import { GateAssignmentsService } from './gate-assignments.service';

@Controller('gate-assignments')
export class GateAssignmentsController {
  constructor(
    private readonly gateAssignmentsService: GateAssignmentsService,
  ) {}

  @Get()
  findAll(@Query('gateId') gateId?: string) {
    return gateId
      ? this.gateAssignmentsService.findByGate(gateId)
      : this.gateAssignmentsService.findAll();
  }

  @Post()
  create(@Body() body: CreateGateAssignmentDto) {
    return this.gateAssignmentsService.create(body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.gateAssignmentsService.remove(id);
  }
}
