import { VehicleStatus } from '@rally-gate/shared';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  ValidateIf,
} from 'class-validator';

/**
 * No `id` on either DTO. `VehiclesService.update` merges the body onto the
 * loaded entity with `Object.assign`, so an `id` in the payload would retarget
 * the save at a different row.
 */
export class CreateVehicleDto {
  @IsInt()
  @IsPositive()
  startNumber: number;

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

  /** Replaces the vehicle's class list; 400 if any id is unknown. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  classIds?: string[];
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  startNumber?: number;

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

  /** Replaces the vehicle's class list; 400 if any id is unknown. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  classIds?: string[];
}

export class VehicleClassDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsBoolean()
  main?: boolean;
}
