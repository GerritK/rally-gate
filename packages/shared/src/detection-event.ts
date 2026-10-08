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
