export interface ClassificationEntry {
  position: number;
  vehicleId: string;
  startNumber: string;
  driverName: string;
  coDriverName?: string;
  durationMs: number;
  gapMs: number;
}

export interface OverallClassificationEntry extends ClassificationEntry {
  /**
   * Stages this crew actually *drove*, which is display information, not the
   * ranking key. `durationMs` covers every counted stage for everyone —
   * missed ones contribute a notional time — so totals are directly
   * comparable and ranking is plain lowest-total-wins.
   *
   * A crew showing fewer completed stages than the leader therefore has
   * notional time inside its total. See "Notional times" in
   * `docs/event-model.md`.
   */
  stagesCompleted: number;
}

export interface SplitClassificationEntry {
  position: number;
  vehicleId: string;
  startNumber: string;
  driverName: string;
  coDriverName?: string;
  splitIndex: number;
  elapsedMs: number;
  gapMs: number;
  stageRunStatus: string;
}

export interface StageOutcomeEntry {
  vehicleId: string;
  startNumber: string;
  driverName: string;
  coDriverName?: string;
  outcome: 'DNF' | 'DNS';
}

export interface SplitGateInfo {
  gateId: string;
  name: string;
  splitIndex: number;
}
