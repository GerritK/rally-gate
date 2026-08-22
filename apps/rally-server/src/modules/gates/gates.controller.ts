import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { UpsertGateDto } from './dto';
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
  upsert(@Param('id') id: string, @Body() gate: UpsertGateDto) {
    return this.gatesService.upsert({ ...gate, id });
  }

  /**
   * 409s (plain message) if the gate is referenced by an ACTIVE/CLOSED
   * stage's assignment. 409s with `{ assignmentCount }` if it has
   * NOT_STARTED-stage assignments that would also be deleted — pass
   * `?force=true` to confirm and cascade-delete those too.
   */
  @Delete(':id')
  remove(@Param('id') id: string, @Query('force') force?: string) {
    return this.gatesService.remove(id, force === 'true');
  }
}
