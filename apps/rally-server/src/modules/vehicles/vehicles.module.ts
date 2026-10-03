import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VehicleClass } from './vehicle-class.entity';
import { VehicleClassesController } from './vehicle-classes.controller';
import { Vehicle } from './vehicle.entity';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [TypeOrmModule.forFeature([Vehicle, VehicleClass])],
  controllers: [VehiclesController, VehicleClassesController],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
