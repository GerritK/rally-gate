import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from '../settings/settings.module';
import { Stage } from '../stages/stage.entity';
import { GateAssignment } from './gate-assignment.entity';
import { GateAssignmentsController } from './gate-assignments.controller';
import { GateAssignmentsService } from './gate-assignments.service';
import { Gate } from './gate.entity';
import { GatesController } from './gates.controller';
import { GatesService } from './gates.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Gate, GateAssignment, Stage]),
    SettingsModule,
  ],
  controllers: [GatesController, GateAssignmentsController],
  providers: [GatesService, GateAssignmentsService],
  exports: [GatesService, GateAssignmentsService],
})
export class GatesModule {}
