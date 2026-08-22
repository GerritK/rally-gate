import { VehicleStatus } from '@rally-gate/shared';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

/**
 * No `id` on either DTO. `VehiclesService.update` merges the body onto the
 * loaded entity with `Object.assign`, so an `id` in the payload would retarget
 * the save at a different row.
 */
export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  startNumber: string;

  @IsString()
  @IsNotEmpty()
  driverName: string;

  // `null` is meaningful here, not just absence: it's how the UI clears an
  // optional field, and only `null` actually writes SQL NULL (CLAUDE.md).
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  coDriverName?: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  transponderId?: string | null;

  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  startNumber?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  driverName?: string;

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  coDriverName?: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  transponderId?: string | null;

  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;
}
