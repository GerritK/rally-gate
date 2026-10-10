import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StageRunsModule } from '../stage-runs/stage-runs.module';
import { StagesModule } from '../stages/stages.module';
import { RallyInfo } from './rally-info.entity';
import { RallyInfoController } from './rally-info.controller';
import { RallyInfoService } from './rally-info.service';
import { RallyLockGuard } from './rally-lock';
import { RallyStatusService } from './rally-status.service';

/** Global: most modules ask for the rally's status before a change. */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([RallyInfo]),
    StagesModule,
    StageRunsModule,
  ],
  controllers: [RallyInfoController],
  providers: [
    RallyInfoService,
    RallyStatusService,
    { provide: APP_GUARD, useClass: RallyLockGuard },
  ],
  exports: [RallyInfoService, RallyStatusService],
})
export class RallyInfoModule {}
