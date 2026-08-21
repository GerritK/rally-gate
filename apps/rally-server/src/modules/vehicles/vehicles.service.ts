import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/db-errors';
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

  async create(data: Partial<Vehicle>): Promise<Vehicle> {
    try {
      return await this.vehicles.save(this.vehicles.create(data));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Start number ${data.startNumber} is already in use`,
        );
      }
      throw err;
    }
  }
}
