import { IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator';

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
}

export class UpdateStageDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(1)
  stageNumber: number;
}
