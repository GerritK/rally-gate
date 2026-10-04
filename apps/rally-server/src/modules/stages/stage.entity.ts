import { StageStatus } from '@rally-gate/shared';
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class Stage {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column()
  stageNumber: number;

  @Column({ type: 'varchar', default: StageStatus.NOT_STARTED })
  status: StageStatus;

  @Column({ type: 'int', nullable: true })
  expectedDurationMs: number | null;

  /** Combined start/finish gate only; null means DEFAULT_MIN_STAGE_DURATION_MS. */
  @Column({ type: 'int', nullable: true })
  minDurationMs: number | null;

  /** Entry ids, frozen on first activation (`StartOrderService`). */
  @Column({ type: 'simple-json', nullable: true })
  startOrder: string[] | null;

  @Column({ type: Date, nullable: true })
  startOrderFrozenAt: Date | null;
}
