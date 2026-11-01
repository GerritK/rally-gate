import { Module } from '@nestjs/common';
import { ClassificationModule } from '../classification/classification.module';
import { SettingsModule } from '../settings/settings.module';
import { StageRunsModule } from '../stage-runs/stage-runs.module';
import { StagesModule } from '../stages/stages.module';
import { EntriesModule } from '../entries/entries.module';
import { StartOrderController } from './start-order.controller';
import { StartOrderService } from './start-order.service';

@Module({
  imports: [
    ClassificationModule,
    StagesModule,
    StageRunsModule,
    EntriesModule,
    SettingsModule,
  ],
  controllers: [StartOrderController],
  providers: [StartOrderService],
})
export class StartOrderModule {}
