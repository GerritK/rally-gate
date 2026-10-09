import { TransponderKind } from '@rally-gate/shared';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Entry } from './entry.entity';

/**
 * Nothing is unique here, on purpose: a car may carry a spare of one kind, and
 * one transponder may sit on several cars — the warnings say so, the desk is
 * never blocked mid-swap, and an ambiguous passing waits for a marshal.
 */
@Entity()
export class EntryTransponder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Orphan delete: replacing an entry's list removes the rows left out,
  // where TypeORM's default would keep them with a null entry.
  @ManyToOne(() => Entry, (entry) => entry.transponders, {
    onDelete: 'CASCADE',
    orphanedRowAction: 'delete',
  })
  entry: Entry;

  @Column({ type: 'varchar' })
  kind: TransponderKind;

  @Column({ type: 'varchar' })
  identifier: string;

  /** "spare car" */
  @Column({ type: 'varchar', nullable: true })
  label: string | null;
}
