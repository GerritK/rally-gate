import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { entryStatusPermission } from '@rally-gate/shared';
import { CurrentPrincipal, Requires } from '../auth/auth.guard';
import { assertMay, deviceOf, type Principal } from '../auth/auth.service';
import { RallyStatusService } from '../rally-info/rally-status.service';
import { CreateEntryDto, UpdateEntryDto } from './dto';
import { EntriesService } from './entries.service';

@Controller('entries')
export class EntriesController {
  constructor(
    private readonly entriesService: EntriesService,
    private readonly rallyStatusService: RallyStatusService,
  ) {}

  @Get()
  findAll() {
    return this.entriesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.entriesService.findOne(id);
  }

  @Requires('editEntry')
  @Post()
  create(@Body() body: CreateEntryDto) {
    return this.entriesService.create(body);
  }

  /**
   * 409 for a change the rally's status locks, see `RallyStatusService`.
   * A status change needs what that change needs: Timing may withdraw a car
   * but edit nothing else, only the organiser disqualifies.
   */
  @Requires('editEntry', 'withdrawEntry')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateEntryDto,
    @CurrentPrincipal() principal: Principal,
  ) {
    const entry = await this.entriesService.findOne(id);
    const { status, ...rest } = body;
    if (Object.values(rest).some((value) => value !== undefined)) {
      assertMay(principal, 'editEntry');
    }
    if (entry && status) {
      assertMay(principal, entryStatusPermission(entry.status, status));
    }
    if (entry) {
      await this.rallyStatusService.assertEntryChangeAllowed(entry, body);
    }
    return this.entriesService.update(id, body, deviceOf(principal));
  }
}
