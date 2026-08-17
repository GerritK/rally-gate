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
