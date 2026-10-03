export interface ClassificationEntry {
  position: number;
  vehicleId: string;
  /** `null` only if the vehicle was deleted after it drove. */
  startNumber: number | null;
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
  /** One per counted stage, in stage order; together they make `durationMs`. */
  stageTimes: OverallStageTime[];
}

export interface OverallStageTime {
  stageId: string;
  durationMs: number;
  /** Charged for a stage the crew didn't complete, not driven. */
  notional: boolean;
}

export interface SplitClassificationEntry {
  position: number;
  vehicleId: string;
  startNumber: number | null;
  driverName: string;
  coDriverName?: string;
  splitIndex: number;
  elapsedMs: number;
  gapMs: number;
  stageRunStatus: string;
}

export interface StageOutcomeEntry {
  vehicleId: string;
  startNumber: number | null;
  driverName: string;
  coDriverName?: string;
  outcome: 'DNF' | 'DNS';
}

export interface SplitGateInfo {
  gateId: string;
  name: string;
  splitIndex: number;
}
