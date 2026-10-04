import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Crew } from '@rally-gate/shared';
import { In, Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/db-errors';
import { VehicleClassDto } from './dto';
import { VehicleClass } from './vehicle-class.entity';
import { Vehicle } from './vehicle.entity';

type VehicleInput = Partial<Omit<Vehicle, 'id' | 'classes'>> & {
  classIds?: string[];
};

export function compareClassNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** `undefined` only if the vehicle was deleted after it drove. */
export function crewOf(vehicle: Vehicle | undefined): Crew {
  return {
    driverFirstName: vehicle?.driverFirstName ?? 'Unknown',
    driverLastName: vehicle?.driverLastName ?? null,
    driverFlag: vehicle?.driverFlag ?? null,
    coDriverFirstName: vehicle?.coDriverFirstName ?? null,
    coDriverLastName: vehicle?.coDriverLastName ?? null,
    coDriverFlag: vehicle?.coDriverFlag ?? null,
    body: vehicle?.body ?? null,
  };
}

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(VehicleClass)
    private readonly classes: Repository<VehicleClass>,
  ) {}

  findAll(): Promise<Vehicle[]> {
    return this.vehicles.find({ order: { startNumber: 'ASC' } });
  }

  findOne(id: string): Promise<Vehicle | null> {
    return this.vehicles.findOneBy({ id });
  }

  findByTransponder(transponderId: string): Promise<Vehicle | null> {
    return this.vehicles.findOneBy({ transponderId });
  }

  async create({ classIds, ...data }: VehicleInput): Promise<Vehicle> {
    const vehicle = this.vehicles.create(data);
    vehicle.classes = (await this.resolveClasses(classIds)) ?? [];
    try {
      return await this.vehicles.save(vehicle);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Start number ${data.startNumber} is already in use`,
        );
      }
      throw err;
    }
  }

  async update(
    id: string,
    { classIds, ...patch }: VehicleInput,
  ): Promise<Vehicle> {
    const vehicle = await this.findOne(id);
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${id} not found`);
    }
    // The validated DTO carries every declared field as an own property, unset
    // ones as `undefined` (ES2022+ class fields). Copied over, they'd blank the
    // returned vehicle even though save() skips them — `null` still clears.
    Object.assign(
      vehicle,
      Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
    );
    const classes = await this.resolveClasses(classIds);
    if (classes) {
      vehicle.classes = classes;
    }
    try {
      return await this.vehicles.save(vehicle);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Start number ${vehicle.startNumber} is already in use`,
        );
      }
      throw err;
    }
  }

  /** Main classes first, then alphabetical — sorted here, not in SQL, so case
   * and numbers ("2WD" before "10WD") sort alike on SQLite and Postgres. */
  async findAllClasses(): Promise<VehicleClass[]> {
    return (await this.classes.find()).sort(
      (a, b) =>
        Number(b.main) - Number(a.main) || compareClassNames(a.name, b.name),
    );
  }

  findClass(id: string): Promise<VehicleClass | null> {
    return this.classes.findOneBy({ id });
  }

  createClass({ name, main }: VehicleClassDto): Promise<VehicleClass> {
    return this.saveClass(this.classes.create({ name, main: main ?? false }));
  }

  async updateClass(
    id: string,
    { name, main }: VehicleClassDto,
  ): Promise<VehicleClass> {
    const vehicleClass = await this.findClass(id);
    if (!vehicleClass) {
      throw new NotFoundException(`Class ${id} not found`);
    }
    vehicleClass.name = name;
    if (main !== undefined) {
      vehicleClass.main = main;
    }
    return this.saveClass(vehicleClass);
  }

  async removeClass(id: string): Promise<void> {
    const { affected } = await this.classes.delete(id);
    if (!affected) {
      throw new NotFoundException(`Class ${id} not found`);
    }
  }

  private async saveClass(vehicleClass: VehicleClass): Promise<VehicleClass> {
    try {
      return await this.classes.save(vehicleClass);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Class ${vehicleClass.name} already exists`,
        );
      }
      throw err;
    }
  }

  private async resolveClasses(
    classIds?: string[],
  ): Promise<VehicleClass[] | undefined> {
    if (classIds === undefined) {
      return undefined;
    }
    const ids = [...new Set(classIds)];
    if (ids.length === 0) {
      return [];
    }
    const classes = await this.classes.findBy({ id: In(ids) });
    if (classes.length !== ids.length) {
      throw new BadRequestException('Unknown vehicle class');
    }
    return classes;
  }
}
