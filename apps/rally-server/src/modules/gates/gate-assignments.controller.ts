import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { GateRole } from '@rally-gate/shared';
import { GateAssignmentsService } from './gate-assignments.service';

@Controller('gate-assignments')
export class GateAssignmentsController {
  constructor(private readonly gateAssignmentsService: GateAssignmentsService) {}

  @Get()
  findAll(@Query('gateId') gateId?: string) {
    return gateId ? this.gateAssignmentsService.findByGate(gateId) : this.gateAssignmentsService.findAll();
  }

  @Post()
  create(@Body() body: { gateId: string; stageId: string; role: GateRole; splitIndex?: number }) {
    return this.gateAssignmentsService.create(body);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.gateAssignmentsService.activate(id);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.gateAssignmentsService.deactivate(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.gateAssignmentsService.remove(id);
  }
}
