import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class Stage {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column()
  stageNumber: number;

  @Column({ default: 'NOT_STARTED' })
  status: string;
}
