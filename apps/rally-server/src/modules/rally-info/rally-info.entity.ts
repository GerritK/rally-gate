import { RallyStatus } from '@rally-gate/shared';
import { Column, Entity, PrimaryColumn } from 'typeorm';

export const RALLY_INFO_ID = 'rally';

@Entity()
export class RallyInfo {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  date?: string;

  @Column({ nullable: true })
  location?: string;

  /** Moved by `RallyStatusService` only, never through the DTO. */
  @Column({ type: 'varchar', default: RallyStatus.SETUP })
  status: RallyStatus;
}
