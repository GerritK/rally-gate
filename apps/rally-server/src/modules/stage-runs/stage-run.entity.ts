import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * No `status` column — STARTED/FINISHED/CANCELLED is derived from
 * `finishTime` plus whether the stage has been closed, see
 * `deriveStageRunStatus` in `stage-runs.service.ts`. Storing it separately
 * would let it drift out of sync with the timestamps it's supposed to
 * summarize.
 *
 * **Several rows per (entryId, stageId) are allowed** — a red-flagged stage
 * gets re-run, and the earlier attempt is kept as evidence rather than
 * overwritten. Only the most recent attempt counts toward results
 * (`latestAttempts` in `stage-runs.service.ts`).
 */
@Entity()
/**
 * Partial unique index: **at most one non-voided attempt per entry+stage**.
 *
 * This is the invariant the whole re-run model rests on — *not voided means
 * it counts*. Without it an attempt could fail to count for two different
 * reasons, voided or superseded by a higher attempt, and only the first would
 * be visible: a superseded run would show FINISHED with a duration while
 * being absent from the results.
 *
 * It also catches two detections of one passing processed concurrently,
 * which both clear the `findActive` check.
 */
@Index(['entryId', 'stageId'], {
  unique: true,
  where: '"voided" = false',
})
export class StageRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 1 for an entry's first go at this stage, incrementing for each re-run;
   * highest wins (`latestAttempts`). Not a creation timestamp or `startTime`:
   * see "StageRun" in `docs/event-model.md`.
   */
  @Column({ type: 'int', default: 1 })
  attempt: number;

  /**
   * Struck out by a marshal, typically after a red flag. A voided attempt
   * counts for nothing and stops blocking the entry from running the stage
   * again, so the start gate is free to open a fresh attempt on its own.
   *
   * This is the *only* reason an attempt doesn't count — see the index
   * above. Voiding the previous attempt is therefore what makes room for a
   * re-run, rather than something done afterwards for tidiness.
   */
  @Column({ default: false })
  voided: boolean;

  /**
   * Set by a marshal (Start now / Finish now / a correction) instead of a
   * gate. A hand time carries the marshal's reaction time, and a protest
   * turns on exactly which times were hand-set. Assigning an unassigned
   * passing doesn't set these: the time is still the gate's.
   */
  @Column({ default: false })
  startManual: boolean;

  @Column({ default: false })
  finishManual: boolean;

  @Column()
  entryId: string;

  @Column()
  stageId: string;

  @Column({ type: Date })
  startTime: Date;

  @Column({ type: Date, nullable: true })
  finishTime?: Date | null;

  @Column({ type: 'int', nullable: true })
  durationMs?: number | null;
}
