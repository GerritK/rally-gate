/**
 * What read the car or driver. A detection matches only transponders of its
 * own kind, so an NFC tap never times a car whose RC transponder shares the
 * number. A fixed list, not free text: matching keys on it.
 */
export enum TransponderKind {
  RC = 'RC',
  NFC = 'NFC',
}

export interface DetectionEvent {
  eventId: string;
  gateId: string;
  /**
   * Absent when the gate saw a passing but identified nothing, e.g. a light
   * barrier. The server then holds it for a marshal to assign an entry.
   */
  transponderId?: string;
  /** Set by the adapter that read `transponderId`; absent means RC, so a gate
   *  on an older version keeps working. Not derived from `source`, which
   *  names the adapter (beam + OpenStint reads RC). */
  transponderKind?: TransponderKind;
  timestampGate: string;
  source: string;
  metadata?: Record<string, unknown>;
}

/**
 * A detection older than this is ignored at ingest: a gate keeps detections
 * it couldn't deliver, and one buffered at a previous event (an NFC tap
 * checking in a car) must not reach the next event's database.
 */
export const DETECTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
