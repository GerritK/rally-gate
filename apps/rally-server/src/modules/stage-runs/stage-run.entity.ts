import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * No `status` column — STARTED/FINISHED/CANCELLED is derived from
 * `finishTime` plus whether the stage has been closed, see
 * `deriveStageRunStatus` in `stage-runs.service.ts`. Storing it separately
 * would let it drift out of sync with the timestamps it's supposed to
 * summarize.
 *
 * One row per (vehicleId, stageId) — a vehicle attempts a stage once.
 */
@Entity()
@Unique(['vehicleId', 'stageId'])
export class StageRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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
