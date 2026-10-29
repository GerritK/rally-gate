import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AccessRole } from '@rally-gate/shared';
import { Roles } from '../auth/auth.guard';
import { RallyStatusService } from '../rally-info/rally-status.service';
import { CreateEntryDto, UpdateEntryDto } from './dto';
import { EntriesService } from './entries.service';

@Controller('entries')
@Roles(AccessRole.CHECK_IN)
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

  @Post()
  create(@Body() body: CreateEntryDto) {
    return this.entriesService.create(body);
  }

  /** 409 for a change the rally's status locks, see `RallyStatusService`. */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateEntryDto) {
    const entry = await this.entriesService.findOne(id);
    if (entry) {
      await this.rallyStatusService.assertEntryChangeAllowed(entry, body);
    }
    return this.entriesService.update(id, body);
  }
}
