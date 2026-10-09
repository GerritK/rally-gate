import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CreatePenaltyDto, PenaltyTypeDto } from './dto';
import { PenaltiesService } from './penalties.service';

@Controller('penalty-types')
export class PenaltyTypesController {
  constructor(private readonly penaltiesService: PenaltiesService) {}

  @Get()
  findAll() {
    return this.penaltiesService.findAllTypes();
  }

  @Post()
  create(@Body() body: PenaltyTypeDto) {
    return this.penaltiesService.createType(body);
  }

  /** Reprices every penalty of the type, already given ones included. */
  @Put(':id')
  update(@Param('id') id: string, @Body() body: PenaltyTypeDto) {
    return this.penaltiesService.updateType(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.penaltiesService.removeType(id);
  }
}

@Controller('penalties')
export class PenaltiesController {
  constructor(private readonly penaltiesService: PenaltiesService) {}

  @Get()
  findAll(@Query('entryId') entryId?: string) {
    return this.penaltiesService.findAll(entryId);
  }

  @Post()
  create(@Body() body: CreatePenaltyDto) {
    return this.penaltiesService.create(body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.penaltiesService.remove(id);
  }
}
