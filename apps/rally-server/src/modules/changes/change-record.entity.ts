import { ChangeAction, type ChangeSnapshot } from '@rally-gate/shared';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only: never updated or deleted, the old value of a correction lives
 * nowhere else. Written in the same transaction as the change itself
 * (`recordChange`), never from an `@OnEvent` listener, which would lose a
 * failed write silently.
 */
@Entity()
@Index(['entryId', 'at'])
export class ChangeRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: Date })
  at: Date;

  /** Null: the server machine, which needs no device. */
  @Column({ type: 'varchar', nullable: true })
  deviceId: string | null;

  @Column({ type: 'varchar' })
  action: ChangeAction;

  /** Null only for a dismissed passing, which was no car. */
  @Column({ type: 'varchar', nullable: true })
  entryId: string | null;

  @Column({ type: 'varchar', nullable: true })
  stageId: string | null;

  /** The record this is about: run, penalty or passing id. */
  @Column({ type: 'varchar' })
  subjectId: string;

  @Column({ type: 'simple-json', nullable: true })
  before: ChangeSnapshot | null;

  @Column({ type: 'simple-json', nullable: true })
  after: ChangeSnapshot | null;
}
