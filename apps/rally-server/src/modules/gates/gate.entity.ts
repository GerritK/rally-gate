import { GateRole } from '@rally-gate/shared';
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class Gate {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar' })
  role: GateRole;

  @Column({ nullable: true })
  stageId?: string;

  @Column({ nullable: true })
  splitIndex?: number;

  @Column({ default: true })
  enabled: boolean;
}
