import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateVehicleDto, UpdateVehicleDto } from './dto';
import { VehiclesService } from './vehicles.service';

@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get()
  findAll() {
    return this.vehiclesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vehiclesService.findOne(id);
  }

  @Post()
  create(@Body() body: CreateVehicleDto) {
    return this.vehiclesService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateVehicleDto) {
    return this.vehiclesService.update(id, body);
  }
}
