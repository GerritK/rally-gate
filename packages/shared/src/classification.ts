export interface ClassificationEntry {
  position: number;
  vehicleId: string;
  startNumber: string;
  driverName: string;
  coDriverName?: string;
  durationMs: number;
  /**
   * Time behind the leader, or `null` when the two totals don't cover the
   * same work and a time gap would be meaningless — see
   * `OverallClassificationEntry.stagesCompleted`. Always a number within a
   * single stage's classification, where every entry is one run.
   */
  gapMs: number | null;
}

export interface OverallClassificationEntry extends ClassificationEntry {
  /**
   * Ranking is by `stagesCompleted` descending *first*, then total time
   * ascending: finishing more of the rally always beats a quicker total over
   * fewer stages. `gapMs` is null for anyone not on the leader's stage count,
   * since their smaller total is a consequence of having driven less.
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
