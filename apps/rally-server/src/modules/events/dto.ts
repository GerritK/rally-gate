import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AssignVehicleDto {
  @IsString()
  @IsNotEmpty()
  vehicleId: string;
}

export class RecentEventsQueryDto {
  /** One gate's detections, e.g. its detail page; otherwise every gate's. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  gateId?: string;
}
