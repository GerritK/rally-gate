import { apiFetch, postRequest } from './client';

export interface DetectionEventRecord {
  eventId: string;
  gateId: string;
  transponderId: string;
  vehicleId?: string;
  timestampGate: string;
  timestampServer: string;
  /** Clock correction applied to `timestampGate`, in ms (0 if none). */
  clockCorrectionMs?: number;
  /** False when the rule engine failed on this detection — stored, but not
   * turned into timing. See `fetchPendingEvents`. */
  processed?: boolean;
}

export function fetchRecentEvents(): Promise<DetectionEventRecord[]> {
  return apiFetch('/events');
}

/**
 * Detections that exist in the database but produced no timing, because rule
 * application failed. Non-empty means passings are missing from the results.
 * The server retries these periodically on its own.
 */
export function fetchPendingEvents(): Promise<DetectionEventRecord[]> {
  return apiFetch('/events/pending');
}

/** Retry now instead of waiting for the server's periodic sweep. */
export function retryPendingEvents(): Promise<{ recovered: number }> {
  return postRequest('/events/pending/retry');
}
