import { applyDecorators } from '@nestjs/common';
import { EntryStatus } from '@rally-gate/shared';
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
} from 'class-validator';

// `null` is meaningful here, not just absence: it's how the UI clears an
// optional field, and only `null` actually writes SQL NULL (CLAUDE.md).
const NullableString = () => applyDecorators(IsOptional(), IsString());

/** A `flag-icons` code (`de`, `gb-eng`) or one of ours (`x-pride`). */
const NullableFlag = () =>
  applyDecorators(IsOptional(), Matches(/^[a-z]+(-[a-z]+)*$/));

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

  @NullableString()
  transponderId?: string | null;

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
