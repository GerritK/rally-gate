import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  startNumber: string;

  @Column()
  driverName: string;

  @Column({ nullable: true })
  coDriverName?: string;

  @Column({ nullable: true })
  transponderId?: string;

  @Column({ default: 'REGISTERED' })
  status: string;
}
