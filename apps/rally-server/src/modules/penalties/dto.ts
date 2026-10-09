import { PenaltyScope } from '@rally-gate/shared';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class PenaltyTierDto {
  @IsInt()
  @IsPositive()
  fromCount: number;

  @IsInt()
  @IsPositive()
  seconds: number;
}

/** That the tiers start at 1 and ascend is checked in `PenaltiesService`. */
export class PenaltyTypeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(PenaltyScope)
  scope: PenaltyScope;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PenaltyTierDto)
  tiers: PenaltyTierDto[];
}

/**
 * A type, or free text: `seconds` and a `note` instead of a `typeId`
 * (checked in `PenaltiesService`). No `createdAt`: it orders penalties
 * within a stage, which decides their tier.
 */
export class CreatePenaltyDto {
  @IsString()
  @IsNotEmpty()
  entryId: string;

  @IsOptional()
  @IsString()
  stageId?: string | null;

  @IsOptional()
  @IsString()
  typeId?: string | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  count?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  seconds?: number | null;

  @IsOptional()
  @IsString()
  note?: string | null;
}
