import { IsNotEmpty, IsString } from 'class-validator';

export class AssignVehicleDto {
  @IsString()
  @IsNotEmpty()
  vehicleId: string;
}
