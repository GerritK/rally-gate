import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class DetectionEventRecord {
  @PrimaryColumn()
  eventId: string;

  @Column()
  gateId: string;

  @Column()
  transponderId: string;

  @Column({ nullable: true })
  vehicleId?: string;

  @Column({ type: Date })
  timestampGate: Date;

  @Column({ type: Date })
  timestampServer: Date;

  @Column({ type: 'text' })
  rawPayload: string;

  @Column({ default: false })
  processed: boolean;
}
