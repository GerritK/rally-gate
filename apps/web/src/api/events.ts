import { apiFetch, postJson, postRequest } from './client';

export interface DetectionEventRecord {
  eventId: string;
  gateId: string;
  /** Null for a passing the gate couldn't identify (a light barrier). */
  transponderId: string | null;
  entryId: string | null;
  /** Unidentified passing at a live gate, waiting for a marshal. */
  awaitingEntry?: boolean;
  timestampGate: string;
  timestampServer: string;
  /** Clock correction applied to `timestampGate`, in ms (0 if none). */
  clockCorrectionMs?: number;
  /** False when the rule engine failed on this detection — stored, but not
   * turned into timing. See `fetchPendingEvents`. */
  processed?: boolean;
}

/** The 100 most recent, newest first; one gate's with `gateId`. */
export function fetchRecentEvents(
  gateId?: string,
): Promise<DetectionEventRecord[]> {
  return apiFetch(
    gateId ? `/events?gateId=${encodeURIComponent(gateId)}` : '/events',
  );
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

/** Passings a gate saw but couldn't identify, oldest first. */
export function fetchAwaitingEvents(): Promise<DetectionEventRecord[]> {
  return apiFetch('/events/awaiting-entry');
}

/** 409s when the rules would time nothing, e.g. a finish before its start. */
export function assignEntryToEvent(
  eventId: string,
  entryId: string,
): Promise<DetectionEventRecord> {
  return postJson(`/events/${encodeURIComponent(eventId)}/assign`, {
    entryId,
  });
}

export function dismissEvent(eventId: string): Promise<DetectionEventRecord> {
  return postRequest(`/events/${encodeURIComponent(eventId)}/dismiss`);
}
