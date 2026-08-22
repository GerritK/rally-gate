import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * No `id` — `RallyInfo` is a singleton pinned to `RALLY_INFO_ID` by the
 * service (one database = one event, see CLAUDE.md), so an id in the body
 * could only ever create a second, unreachable row.
 */
export class UpsertRallyInfoDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  location?: string;
}
