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

@Controller('entry-classes')
export class EntryClassesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Get()
  findAll() {
    return this.entriesService.findAllClasses();
  }

  @Post()
  create(@Body() body: EntryClassDto) {
    return this.entriesService.createClass(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: EntryClassDto) {
    return this.entriesService.updateClass(id, body);
  }

  /** Removes the class from every entry in it; runs are untouched. */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.entriesService.removeClass(id);
  }
}
