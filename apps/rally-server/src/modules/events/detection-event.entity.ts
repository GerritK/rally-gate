import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class DetectionEventRecord {
  @PrimaryColumn()
  eventId: string;

  @Column()
  gateId: string;

  /** Null for a passing the gate couldn't identify (a light barrier). */
  @Column({ type: 'varchar', nullable: true })
  transponderId: string | null;

  @Column({ type: 'varchar', nullable: true })
  vehicleId: string | null;

  /**
   * An unidentified passing at a gate that was live on a stage: stored untimed
   * until a marshal assigns the vehicle or dismisses it. Cleared by either.
   */
  @Column({ default: false })
  awaitingVehicle: boolean;

  /** As reported by the gate, never rewritten — the raw evidence. */
  @Column({ type: Date })
  timestampGate: Date;

  @Column({ type: Date })
  timestampServer: Date;

  /**
   * Clock correction applied to `timestampGate` when this detection was
   * processed, in ms (0 when the gate's offset was within the deadband).
   * Stored per detection rather than only on `Gate` so a run stays
   * explainable and recomputable after the gate's offset has moved on:
   * the effective time is always `timestampGate + clockCorrectionMs`.
   */
  @Column({ type: 'int', default: 0 })
  clockCorrectionMs: number;

  @Column({ type: 'text' })
  rawPayload: string;

  @Column({ default: false })
  processed: boolean;
}
