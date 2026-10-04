import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateEntryDto, UpdateEntryDto } from './dto';
import { EntriesService } from './entries.service';

@Controller('entries')
export class EntriesController {
  constructor(private readonly entriesService: EntriesService) {}

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

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateEntryDto) {
    return this.entriesService.update(id, body);
  }
}
