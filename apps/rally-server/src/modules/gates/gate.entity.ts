import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class Gate {
  @PrimaryColumn()
  id: string;

  @Column({ default: '' })
  name: string;

  @Column({ type: 'datetime', nullable: true })
  lastHeartbeatAt?: Date;

  @Column({ nullable: true })
  capabilities?: string;
}
