import { applyDecorators } from '@nestjs/common';
import { EntryStatus, TransponderKind } from '@rally-gate/shared';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// `null` is meaningful here, not just absence: it's how the UI clears an
// optional field, and only `null` actually writes SQL NULL (CLAUDE.md).
const NullableString = () => applyDecorators(IsOptional(), IsString());

/** A `flag-icons` code (`de`, `gb-eng`) or one of ours (`x-pride`). */
const NullableFlag = () =>
  applyDecorators(IsOptional(), Matches(/^[a-z]+(-[a-z]+)*$/));

/** No `id` either: a list replaces the entry's transponders as a whole. */
export class EntryTransponderDto {
  @IsEnum(TransponderKind)
  kind: TransponderKind;

  // As long as a detection's id may be, or a registered one could never match.
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  identifier: string;

  @NullableString()
  label?: string | null;
}

/**
 * No `id` on any entry DTO. `EntriesService.update` merges the body onto
 * the loaded entity with `Object.assign`, so an `id` in the payload would
 * retarget the save at a different row.
 */
class EntryDetailsDto {
  @NullableString()
  driverLastName?: string | null;

  @NullableFlag()
  driverFlag?: string | null;

  @NullableString()
  coDriverFirstName?: string | null;

  @NullableString()
  coDriverLastName?: string | null;

  @NullableFlag()
  coDriverFlag?: string | null;

  @NullableString()
  chassis?: string | null;

  @NullableString()
  body?: string | null;

  /** Replaces the entry's transponders. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntryTransponderDto)
  transponders?: EntryTransponderDto[];

  @IsOptional()
  @IsEnum(EntryStatus)
  status?: EntryStatus;

  /** Replaces the entry's class list; 400 if any id is unknown. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  classIds?: string[];
}

export class CreateEntryDto extends EntryDetailsDto {
  @IsInt()
  @IsPositive()
  startNumber: number;

  @IsString()
  @IsNotEmpty()
  driverFirstName: string;
}

export class UpdateEntryDto extends EntryDetailsDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  startNumber?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  driverFirstName?: string;
}

export class EntryClassDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsBoolean()
  main?: boolean;
}
