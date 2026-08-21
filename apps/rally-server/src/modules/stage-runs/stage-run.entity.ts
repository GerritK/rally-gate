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

  @Column({ type: 'datetime' })
  startTime: Date;

  @Column({ type: 'datetime', nullable: true })
  finishTime?: Date;

  @Column({ nullable: true })
  durationMs?: number;
}
