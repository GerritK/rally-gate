import { apiFetch } from './client';

export interface DetectionEventRecord {
  eventId: string;
  gateId: string;
  transponderId: string;
  vehicleId?: string;
  timestampGate: string;
  timestampServer: string;
}

export function fetchRecentEvents(): Promise<DetectionEventRecord[]> {
  return apiFetch('/events');
}
