export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:57430';

export interface DetectionEventRecord {
  eventId: string;
  gateId: string;
  transponderId: string;
  vehicleId?: string;
  timestampGate: string;
  timestampServer: string;
}

export interface StageRun {
  id: string;
  vehicleId: string;
  stageId: string;
  startTime: string;
  finishTime?: string;
  durationMs?: number;
  status: string;
}

export interface Stage {
  id: string;
  name: string;
  stageNumber: number;
  status: string;
}

export interface StageSplit {
  id: string;
  stageRunId: string;
  gateId: string;
  splitIndex: number;
  timestamp: string;
  elapsedMs: number;
}

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

export interface Gate {
  id: string;
  name: string;
  lastHeartbeatAt?: string;
  capabilities?: string;
}

export const GATE_ROLES = [
  'stage_start',
  'stage_split',
  'stage_finish',
  'time_control',
  'pre_start',
  'stop_control',
  'parc_ferme_in',
  'parc_ferme_out',
  'service_in',
  'service_out',
  'manual_checkpoint',
] as const;

export interface GateAssignment {
  id: string;
  gateId: string;
  stageId: string;
  role: string;
  splitIndex?: number;
  active: boolean;
}

export interface SplitGateInfo {
  gateId: string;
  name: string;
  splitIndex: number;
}

export interface StageOutcomeEntry {
  vehicleId: string;
  startNumber: string;
  driverName: string;
  coDriverName?: string;
  outcome: 'DNF' | 'DNS';
}

export async function fetchRecentEvents(): Promise<DetectionEventRecord[]> {
  const res = await fetch(`${API_BASE}/events`);
  return res.json();
}

export async function fetchStageRuns(): Promise<StageRun[]> {
  const res = await fetch(`${API_BASE}/stage-runs`);
  return res.json();
}

export async function fetchStages(): Promise<Stage[]> {
  const res = await fetch(`${API_BASE}/stages`);
  return res.json();
}

export async function fetchSplitsForRun(stageRunId: string): Promise<StageSplit[]> {
  const res = await fetch(`${API_BASE}/stage-runs/${stageRunId}/splits`);
  return res.json();
}

export async function fetchStageClassification(stageId: string): Promise<ClassificationEntry[]> {
  const res = await fetch(`${API_BASE}/classification/stages/${stageId}`);
  return res.json();
}

export async function fetchOverallClassification(): Promise<OverallClassificationEntry[]> {
  const res = await fetch(`${API_BASE}/classification/overall`);
  return res.json();
}

export async function fetchSplitGatesForStage(stageId: string): Promise<SplitGateInfo[]> {
  const res = await fetch(`${API_BASE}/classification/stages/${stageId}/split-gates`);
  return res.json();
}

export async function fetchGates(): Promise<Gate[]> {
  const res = await fetch(`${API_BASE}/gates`);
  return res.json();
}

export async function fetchGateAssignments(): Promise<GateAssignment[]> {
  const res = await fetch(`${API_BASE}/gate-assignments`);
  return res.json();
}

export async function createGateAssignment(assignment: {
  gateId: string;
  stageId: string;
  role: string;
  splitIndex?: number;
}): Promise<GateAssignment> {
  const res = await fetch(`${API_BASE}/gate-assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(assignment),
  });
  return res.json();
}

export async function activateGateAssignment(id: string): Promise<GateAssignment> {
  const res = await fetch(`${API_BASE}/gate-assignments/${id}/activate`, { method: 'POST' });
  return res.json();
}

export async function deactivateGateAssignment(id: string): Promise<GateAssignment> {
  const res = await fetch(`${API_BASE}/gate-assignments/${id}/deactivate`, { method: 'POST' });
  return res.json();
}

export async function deleteGateAssignment(id: string): Promise<void> {
  await fetch(`${API_BASE}/gate-assignments/${id}`, { method: 'DELETE' });
}

export async function fetchSplitClassification(
  stageId: string,
  splitIndex: number,
): Promise<SplitClassificationEntry[]> {
  const res = await fetch(`${API_BASE}/classification/stages/${stageId}/splits/${splitIndex}`);
  return res.json();
}

export async function fetchNonFinishers(stageId: string): Promise<StageOutcomeEntry[]> {
  const res = await fetch(`${API_BASE}/classification/stages/${stageId}/non-finishers`);
  return res.json();
}

export async function closeStage(stageId: string): Promise<Stage> {
  const res = await fetch(`${API_BASE}/stages/${stageId}/close`, { method: 'POST' });
  return res.json();
}
