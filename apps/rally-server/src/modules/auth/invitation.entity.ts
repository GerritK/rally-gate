import { AccessRole } from '@rally-gate/shared';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Never deleted, only blocked: corrections, penalties and passing assignments
 * name the device, and through it this invitation, as evidence for a protest.
 */
@Entity()
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  label: string;

  @Column({ type: 'varchar' })
  role: AccessRole;

  @Column({ type: 'simple-json' })
  stageIds: string[];

  /** Plain, not hashed: the organiser prints it again from the dashboard. */
  @Column({ type: 'varchar', unique: true })
  code: string;

  @Column({ type: 'boolean', default: false })
  blocked: boolean;

  @Column({ type: Date })
  createdAt: Date;
}
