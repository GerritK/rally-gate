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
}
