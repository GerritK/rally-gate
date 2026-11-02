import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * No `status` column — STARTED/FINISHED/DNF is derived from
 * `finishTime`, `dnf` and `voided`, see `deriveStageRunStatus` in
 * `stage-runs.service.ts`. Storing it separately would let it drift out of
 * sync with the timestamps it's supposed to summarize.
 *
 * **Several rows per (entryId, stageId) are allowed** — a red-flagged stage
 * gets re-run, and the earlier attempt is kept as evidence rather than
 * overwritten. A shakedown also keeps every run the car drove. Results take
 * the fastest finished one (`countingRuns` in `stage-runs.service.ts`).
 */
@Entity()
/**
 * Partial unique index: **at most one non-voided attempt per entry, stage
 * and run** — on a counted stage `run` is always 1, so one per entry+stage.
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
@Index(['entryId', 'stageId', 'run'], {
  unique: true,
  where: '"voided" = false',
})
/**
 * At most one open run per entry+stage, a shakedown included. A DNF
 * run is closed: on a shakedown the car may start again after a DNF.
 */
@Index(['entryId', 'stageId'], {
  unique: true,
  where: '"voided" = false AND "dnf" = false AND "finishTime" IS NULL',
})
export class StageRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 1 for an entry's first go at this stage, incrementing for each re-run;
   * highest is the latest. Not a creation timestamp or `startTime`:
   * see "StageRun" in `docs/event-model.md`.
   */
  @Column({ type: 'int', default: 1 })
  attempt: number;

  /**
   * Always 1 on a counted stage. On a shakedown (`StageScoring.NONE`) each
   * run takes its `attempt`, so every non-voided one counts side by side.
   */
  @Column({ type: 'int', default: 1 })
  run: number;

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
   * DNF on this stage: set by a marshal, or by closing the stage on a run
   * still open. Unlike `voided` the run still counts, as a non-finish: it
   * gets the notional time and blocks a restart on a counted stage. A gate
   * finish after it times nothing; a finish typed in by correction clears it.
   */
  @Column({ default: false })
  dnf: boolean;

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

  /**
   * The slot on a slot stage (`docs/event-model.md` "Start slots"), server
   * clock; null on a gate-started run. Set as `startTime` too, which a
   * correction may move: the jump start is still measured against this.
   */
  @Column({ type: Date, nullable: true })
  plannedStartTime: Date | null;

  /** Effective time of the earliest start passing; slot runs only. */
  @Column({ type: Date, nullable: true })
  startPassingAt: Date | null;

  /** The marshal ruled the jump-start mark needs no penalty. */
  @Column({ default: false })
  jumpStartDismissed: boolean;
}
