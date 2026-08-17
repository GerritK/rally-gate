import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GateAssignment } from './gate-assignment.entity';
import { GateAssignmentsController } from './gate-assignments.controller';
import { GateAssignmentsService } from './gate-assignments.service';
import { Gate } from './gate.entity';
import { GatesController } from './gates.controller';
import { GatesService } from './gates.service';

@Module({
  imports: [TypeOrmModule.forFeature([Gate, GateAssignment])],
  controllers: [GatesController, GateAssignmentsController],
  providers: [GatesService, GateAssignmentsService],
  exports: [GatesService, GateAssignmentsService],
})
export class GatesModule {}
