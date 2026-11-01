import { StageScoring, StartMode } from '@rally-gate/shared';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * `status` is deliberately absent from both DTOs. It's owned by
 * `StagesService.activate`/`close` alone — a body that could set it would
 * flip a stage to ACTIVE without ever activating its gate assignments, or to
 * CLOSED without deactivating them, which is precisely the split
 * `docs/architecture.md` ("Gate assignment: plan vs. live") exists to keep
 * consistent. New stages get NOT_STARTED from the column default; an update
 * omitting the property leaves the stored value untouched (TypeORM `save()`
 * skips `undefined` — see CLAUDE.md).
 */
export class CreateStageDto {
  // Stage ids are user-typed and used as path segments (`/stages/:id/activate`),
  // so keep them URL-safe rather than discovering it via a broken route.
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'id may only contain letters, numbers, underscores and dashes',
  })
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(1)
  stageNumber: number;

  @IsOptional()
  @IsEnum(StageScoring)
  scoring?: StageScoring;

  @IsOptional()
  @IsEnum(StartMode)
  startMode?: StartMode;
}

export class UpdateStageDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(1)
  stageNumber: number;

  @IsOptional()
  @IsEnum(StageScoring)
  scoring?: StageScoring;

  @IsOptional()
  @IsEnum(StartMode)
  startMode?: StartMode;

  // null clears it; omitted leaves it as stored.
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedDurationMs?: number | null;

  // null clears it (back to the default); omitted leaves it as stored.
  @IsOptional()
  @IsInt()
  @Min(1)
  minDurationMs?: number | null;

  // Timetable only; null clears, omitted leaves it as stored.
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsISO8601()
  firstStartTime?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1000)
  slotIntervalMs?: number | null;
}

export class DelaySlotsDto {
  @IsInt()
  @Min(1)
  delayMs: number;
}

export class NewSlotDto {
  @IsString()
  @IsNotEmpty()
  entryId: string;
}
