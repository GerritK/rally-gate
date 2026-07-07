import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity()
@Unique(['stageRunId', 'gateId'])
export class StageSplit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  stageRunId: string;

  @Column()
  gateId: string;

  @Column()
  splitIndex: number;

  @Column({ type: 'datetime' })
  timestamp: Date;

  @Column()
  elapsedMs: number;
}
