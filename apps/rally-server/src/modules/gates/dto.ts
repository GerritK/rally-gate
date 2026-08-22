import { GateRole } from '@rally-gate/shared';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * Only `name` is settable. `lastHeartbeatAt` and `capabilities` are
 * gate-reported facts stamped by `GatesService.recordHeartbeat` — letting a
 * REST client write them would make a gate look online when it isn't, which
 * is the one thing the Hardware page's online/offline indicator is for.
 */
export class UpsertGateDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

/**
 * No `active`. Activation is per-stage, never per-assignment
 * (`POST /stages/:id/activate`), so `GateAssignmentsService.create` forces
 * `active: false` — accepting it here would let a client make a gate live
 * while bypassing the cross-stage conflict check entirely.
 */
export class CreateGateAssignmentDto {
  @IsString()
  @IsNotEmpty()
  gateId: string;

  @IsString()
  @IsNotEmpty()
  stageId: string;

  @IsEnum(GateRole)
  role: GateRole;

  @IsOptional()
  @IsInt()
  @Min(0)
  splitIndex?: number;
}
