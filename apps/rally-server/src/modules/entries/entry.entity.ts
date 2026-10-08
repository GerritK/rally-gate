import { Crew, EntryStatus } from '@rally-gate/shared';
import {
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EntryClass } from './entry-class.entity';
import { EntryTransponder } from './entry-transponder.entity';

@Entity()
export class Entry implements Crew {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', unique: true })
  startNumber: number;

  @Column()
  driverFirstName: string;

  @Column({ type: 'varchar', nullable: true })
  driverLastName: string | null;

  @Column({ type: 'varchar', nullable: true })
  driverFlag: string | null;

  @Column({ type: 'varchar', nullable: true })
  coDriverFirstName: string | null;

  @Column({ type: 'varchar', nullable: true })
  coDriverLastName: string | null;

  @Column({ type: 'varchar', nullable: true })
  coDriverFlag: string | null;

  /** The RC chassis (HPI WR8, Tamiya TT-02). */
  @Column({ type: 'varchar', nullable: true })
  chassis: string | null;

  /** The body shell, i.e. the car it looks like (Ford Focus, Toyota Yaris). */
  @Column({ type: 'varchar', nullable: true })
  body: string | null;

  @OneToMany(() => EntryTransponder, (t) => t.entry, {
    eager: true,
    cascade: true,
  })
  transponders: EntryTransponder[];

  @Column({ type: 'varchar', default: EntryStatus.REGISTERED })
  status: EntryStatus;

  // Many-to-many: a car can be in "2WD" and "Junior" at once, each a separate
  // ranking over the same runs. The junction rows cascade when a class goes.
  @ManyToMany(() => EntryClass, { eager: true })
  @JoinTable()
  classes: EntryClass[];
}
