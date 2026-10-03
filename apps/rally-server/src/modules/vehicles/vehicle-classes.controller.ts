import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { VehicleClassDto } from './dto';
import { VehiclesService } from './vehicles.service';

@Controller('vehicle-classes')
export class VehicleClassesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get()
  findAll() {
    return this.vehiclesService.findAllClasses();
  }

  @Post()
  create(@Body() body: VehicleClassDto) {
    return this.vehiclesService.createClass(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: VehicleClassDto) {
    return this.vehiclesService.updateClass(id, body);
  }

  /** Removes the class from every vehicle in it; runs are untouched. */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.vehiclesService.removeClass(id);
  }
}
