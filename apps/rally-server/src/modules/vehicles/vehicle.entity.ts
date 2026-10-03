import { VehicleStatus } from '@rally-gate/shared';
import {
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { VehicleClass } from './vehicle-class.entity';

@Entity()
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', unique: true })
  startNumber: number;

  @Column()
  driverName: string;

  @Column({ type: 'varchar', nullable: true })
  coDriverName?: string | null;

  @Column({ type: 'varchar', nullable: true })
  transponderId?: string | null;

  @Column({ type: 'varchar', default: VehicleStatus.REGISTERED })
  status: VehicleStatus;

  // Many-to-many: a car can be in "2WD" and "Junior" at once, each a separate
  // ranking over the same runs. The junction rows cascade when a class goes.
  @ManyToMany(() => VehicleClass, { eager: true })
  @JoinTable()
  classes: VehicleClass[];
}
