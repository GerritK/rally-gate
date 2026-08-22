import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

/**
 * `@IsISO8601` is the boundary half of the timestamp guard — it rejects
 * `"yesterday-ish"` here with a field-named 400 rather than letting
 * `new Date()` turn it into an Invalid Date. The service still re-checks
 * (`parseTime`/`assertValidRunDuration` in `stage-runs.service.ts`), because
 * ordering — finish after start — isn't a per-field property and the rule
 * engine reaches those paths without passing through this pipe at all.
 */
export class CreateStageRunDto {
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @IsString()
  @IsNotEmpty()
  stageId: string;

  @IsISO8601()
  startTime: string;

  @IsOptional()
  @IsISO8601()
  finishTime?: string;
}

export class CorrectStageRunDto {
  @IsOptional()
  @IsISO8601()
  startTime?: string;

  /**
   * Explicit `null` clears the finish time (reopening a run); omitting the
   * property leaves it alone. `@ValidateIf` lets null through to preserve
   * that distinction — `@IsOptional()` alone would too, but being explicit
   * keeps it from being "tidied" into a plain optional later.
   */
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsISO8601()
  finishTime?: string | null;
}
