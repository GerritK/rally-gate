export interface DetectionEvent {
  eventId: string;
  gateId: string;
  /**
   * Absent when the gate saw a passing but identified nothing, e.g. a light
   * barrier. The server then holds it for a marshal to assign a vehicle.
   */
  transponderId?: string;
  timestampGate: string;
  source: string;
  metadata?: Record<string, unknown>;
}
