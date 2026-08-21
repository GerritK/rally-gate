import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
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
