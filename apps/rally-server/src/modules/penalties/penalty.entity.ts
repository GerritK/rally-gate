import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * No price column: what an offence costs depends on the entry's other
 * penalties of the type (tiers, possibly across the rally), so a correction
 * on one stage can reprice another. `pricePenalties` computes it on read.
 */
@Entity()
export class Penalty {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  entryId: string;

  /** Null: for the whole rally, not one stage (a jury decision). */
  @Column({ type: 'varchar', nullable: true })
  stageId: string | null;

  /** Null: a free-text penalty, priced by `seconds`. */
  @Column({ type: 'varchar', nullable: true })
  typeId: string | null;

  /** Offences in this one row ("3× crossed the course marking"). */
  @Column({ type: 'int', default: 1 })
  count: number;

  /** Free-text penalties only: seconds per offence. */
  @Column({ type: 'int', nullable: true })
  seconds: number | null;

  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  /** Orders penalties within a stage, so it keeps milliseconds (app-set). */
  @Column({ type: Date })
  createdAt: Date;
}
