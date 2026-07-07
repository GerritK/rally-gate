import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from './vehicle.entity';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicles: Repository<Vehicle>,
  ) {}

  findAll(): Promise<Vehicle[]> {
    return this.vehicles.find();
  }

  findOne(id: string): Promise<Vehicle | null> {
    return this.vehicles.findOneBy({ id });
  }

  findByTransponder(transponderId: string): Promise<Vehicle | null> {
    return this.vehicles.findOneBy({ transponderId });
  }

  create(data: Partial<Vehicle>): Promise<Vehicle> {
    return this.vehicles.save(this.vehicles.create(data));
  }
}
