import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AssignEntryDto {
  @IsString()
  @IsNotEmpty()
  entryId: string;
}

export class RecentEventsQueryDto {
  /** One gate's detections, e.g. its detail page; otherwise every gate's. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  gateId?: string;
}
