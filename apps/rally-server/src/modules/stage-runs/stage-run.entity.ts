import { StageRunStatus } from '@rally-gate/shared';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
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

  @Column({ type: 'varchar', default: StageRunStatus.STARTED })
  status: StageRunStatus;
}
