import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Redirect,
} from '@nestjs/common';
import { ApiErrorCode, GATE_ID_PATTERN } from '@rally-gate/shared';
import { apiError } from '../../common/api-error';
import { Private } from '../auth/auth.guard';
import { UpsertGateDto } from './dto';
import { GatesService } from './gates.service';

@Controller('gates')
export class GatesController {
  constructor(private readonly gatesService: GatesService) {}

  @Get()
  findAll() {
    return this.gatesService.findAll();
  }

  /** 409 while a stage is active; otherwise one result per online gate. */
  @Post('power-off')
  powerOffAll() {
    return this.gatesService.powerOffAll();
  }

  /** A link, so the browser opens the gate in a new tab without a popup blocker in the way. */
  @Get(':id/configure')
  @Private()
  @Redirect()
  async configure(@Param('id') id: string) {
    return { url: await this.gatesService.configureUrl(id) };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.gatesService.findOne(id);
  }

  @Put(':id')
  upsert(@Param('id') id: string, @Body() gate: UpsertGateDto) {
    if (!GATE_ID_PATTERN.test(id)) {
      throw new BadRequestException(
        apiError(ApiErrorCode.INVALID_GATE_ID, `Invalid gate id ${id}`),
      );
    }
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
