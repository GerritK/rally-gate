import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { EntryClassDto } from './dto';
import { EntriesService } from './entries.service';
import { RallyStatus } from '@rally-gate/shared';
import { LockedWhen } from '../rally-info/rally-lock';

@Controller('entry-classes')
export class EntryClassesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Get()
  findAll() {
    return this.entriesService.findAllClasses();
  }

  @LockedWhen(RallyStatus.CLOSED)
  @Post()
  create(@Body() body: EntryClassDto) {
    return this.entriesService.createClass(body);
  }

  @LockedWhen(RallyStatus.RUNNING, RallyStatus.CLOSED)
  @Put(':id')
  update(@Param('id') id: string, @Body() body: EntryClassDto) {
    return this.entriesService.updateClass(id, body);
  }

  /** Removes the class from every entry in it; runs are untouched. */
  @LockedWhen(RallyStatus.RUNNING, RallyStatus.CLOSED)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.entriesService.removeClass(id);
  }
}
