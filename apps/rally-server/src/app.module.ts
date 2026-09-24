import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { buildDatabaseConfig } from './config/database.config';
import { BrokerModule } from './modules/broker/broker.module';
import { ClassificationModule } from './modules/classification/classification.module';
import { EventsModule } from './modules/events/events.module';
import { GatesModule } from './modules/gates/gates.module';
import { LiveModule } from './modules/live/live.module';
import { NtpModule } from './modules/ntp/ntp.module';
import { RallyInfoModule } from './modules/rally-info/rally-info.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StageRunsModule } from './modules/stage-runs/stage-runs.module';
import { StagesModule } from './modules/stages/stages.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRoot(buildDatabaseConfig()),
    BrokerModule,
    NtpModule,
    GatesModule,
    VehiclesModule,
    RallyInfoModule,
    SettingsModule,
    StagesModule,
    StageRunsModule,
    EventsModule,
    LiveModule,
    ClassificationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
