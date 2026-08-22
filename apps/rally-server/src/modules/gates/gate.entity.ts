import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class Gate {
  @PrimaryColumn()
  id: string;

  @Column({ default: '' })
  name: string;

  @Column({ type: Date, nullable: true })
  lastHeartbeatAt?: Date;

  @Column({ nullable: true })
  capabilities?: string;

  /**
   * Latest measured difference between this gate's clock and the server's,
   * from the `sentAt` in its heartbeat: `arrivedAt - sentAt`. **Positive
   * means the gate's clock is behind the server's**, so adding it to a
   * gate timestamp brings that timestamp onto server time.
   *
   * A one-way measurement, so it's really `offset + transit latency` and
   * can't distinguish the two — which is why it is only *applied* past a
   * threshold (`GatesService.clockCorrectionMsFor`). Null until a heartbeat
   * carrying `sentAt` arrives.
   */
  @Column({ type: 'int', nullable: true })
  clockOffsetMs?: number | null;
}
