import { Module } from '@nestjs/common';
import { ClassificationModule } from '../classification/classification.module';
import { SettingsModule } from '../settings/settings.module';
import { StagesModule } from '../stages/stages.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { StartOrderController } from './start-order.controller';
import { StartOrderService } from './start-order.service';

@Module({
  imports: [ClassificationModule, StagesModule, VehiclesModule, SettingsModule],
  controllers: [StartOrderController],
  providers: [StartOrderService],
})
export class StartOrderModule {}
