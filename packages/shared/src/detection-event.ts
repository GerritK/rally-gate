export interface DetectionEvent {
  eventId: string;
  gateId: string;
  transponderId: string;
  timestampGate: string;
  source: string;
  metadata?: Record<string, unknown>;
}
