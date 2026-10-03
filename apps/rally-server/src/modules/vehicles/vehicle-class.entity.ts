import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class VehicleClass {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  /**
   * A main class (4WD, 2WD) as opposed to a category that cuts across them
   * (Rookie, Stock). Only steers the UI towards one main class per vehicle;
   * rankings treat both alike and combine any of them.
   */
  @Column({ default: false })
  main: boolean;
}
