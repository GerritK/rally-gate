import { VehicleStatus } from '@rally-gate/shared';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  startNumber: string;

  @Column()
  driverName: string;

  @Column({ type: 'varchar', nullable: true })
  coDriverName?: string | null;

  @Column({ type: 'varchar', nullable: true })
  transponderId?: string | null;

  @Column({ type: 'varchar', default: VehicleStatus.REGISTERED })
  status: VehicleStatus;
}
