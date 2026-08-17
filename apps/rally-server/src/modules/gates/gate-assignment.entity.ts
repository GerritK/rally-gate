import { GateRole } from '@rally-gate/shared';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class GateAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  gateId: string;

  @Column()
  stageId: string;

  @Column({ type: 'varchar' })
  role: GateRole;

  @Column({ nullable: true })
  splitIndex?: number;

  @Column({ default: false })
  active: boolean;
}
