import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * No `status` column — STARTED/FINISHED/CANCELLED is derived from
 * `finishTime` plus whether the stage has been closed, see
 * `deriveStageRunStatus` in `stage-runs.service.ts`. Storing it separately
 * would let it drift out of sync with the timestamps it's supposed to
 * summarize.
 *
 * **Several rows per (vehicleId, stageId) are allowed** — a red-flagged stage
 * gets re-run, and the earlier attempt is kept as evidence rather than
 * overwritten. Only the most recent attempt counts toward results
 * (`latestAttempts` in `stage-runs.service.ts`).
 */
@Entity()
/**
 * Partial unique index: **at most one non-voided attempt per vehicle+stage**.
 *
 * This is the invariant the whole re-run model rests on — *not voided means
 * it counts*. Without it an attempt could fail to count for two different
 * reasons, voided or superseded by a higher attempt, and only the first would
 * be visible: a superseded run would show FINISHED with a duration while
 * being absent from the results.
 *
 * It also still backstops the race the original plain unique constraint
 * covered, where two detections for the same passing are processed
 * concurrently and both clear the `findActive` check.
 */
@Index(['vehicleId', 'stageId'], {
  unique: true,
  where: '"voided" = false',
})
export class StageRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 1 for a vehicle's first go at this stage, incrementing for each re-run.
   * Highest attempt wins — see `latestAttempts` in `stage-runs.service.ts`.
   *
   * An explicit counter rather than a creation timestamp, for two reasons. A
   * `@CreateDateColumn` normalises to sqlite `datetime`, which has only
   * second precision, so two attempts recorded in the same second compare
   * *equal* and the "latest" becomes whichever row the driver returned
   * first — a silently wrong result rather than an error. And `startTime`
   * can't serve either, since the correction endpoints can edit it, and
   * which run supersedes which must not change because a marshal fixed a
   * timestamp.
   */
  @Column({ type: 'int', default: 1 })
  attempt: number;

  /**
   * Struck out by a marshal, typically after a red flag. A voided attempt
   * counts for nothing and stops blocking the vehicle from running the stage
   * again, so the start gate is free to open a fresh attempt on its own.
   *
   * This is the *only* reason an attempt doesn't count — see the index
   * above. Voiding the previous attempt is therefore what makes room for a
   * re-run, rather than something done afterwards for tidiness.
   */
  @Column({ default: false })
  voided: boolean;

  @Column()
  vehicleId: string;

  @Column()
  stageId: string;

  /**
   * `type: Date` (the constructor), not `'datetime'`: `'datetime'` is
   * sqlite-only and fails Postgres metadata validation at startup, while
   * `Date` normalizes to `datetime` on sqlite and `timestamp` on Postgres.
   * Same reason `'timestamp'` is wrong here — it's the Postgres-only mirror.
   */
  @Column({ type: Date })
  startTime: Date;

  /**
   * `| null`, not just optional: TypeORM's save() skips properties that are
   * `undefined` (leaves the DB column untouched) but writes `null` fields
   * as SQL NULL. Clearing a finish time needs the latter — see
   * StageRunsService.correctRun.
   */
  @Column({ type: Date, nullable: true })
  finishTime?: Date | null;

  /**
   * Explicit `type: 'int'` needed: reflect-metadata reduces a `number |
   * null` property type to generic `Object`, which better-sqlite3 rejects
   * as a column type when TypeORM tries to infer it from the TS type.
   */
  @Column({ type: 'int', nullable: true })
  durationMs?: number | null;
}
