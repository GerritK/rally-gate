import { VehicleStatus } from '@rally-gate/shared';

export { VehicleStatus };

export const API_BASE =
  import.meta.env.VITE_API_URL ?? 'http://localhost:57430';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.message ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

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

export interface Vehicle {
  id: string;
  startNumber: string;
  driverName: string;
  coDriverName?: string | null;
  transponderId?: string | null;
  status: VehicleStatus;
}

export interface RallyInfo {
  name: string;
  date?: string;
  location?: string;
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

export function fetchRecentEvents(): Promise<DetectionEventRecord[]> {
  return apiFetch('/events');
}

export function fetchStageRuns(): Promise<StageRun[]> {
  return apiFetch('/stage-runs');
}

export function fetchStages(): Promise<Stage[]> {
  return apiFetch('/stages');
}

export function fetchStage(id: string): Promise<Stage> {
  return apiFetch(`/stages/${id}`);
}

export function upsertStage(
  id: string,
  input: { name: string; stageNumber: number; status: string },
): Promise<Stage> {
  return apiFetch(`/stages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function fetchSplitsForRun(stageRunId: string): Promise<StageSplit[]> {
  return apiFetch(`/stage-runs/${stageRunId}/splits`);
}

export function fetchStageClassification(
  stageId: string,
): Promise<ClassificationEntry[]> {
  return apiFetch(`/classification/stages/${stageId}`);
}

export function fetchOverallClassification(): Promise<
  OverallClassificationEntry[]
> {
  return apiFetch('/classification/overall');
}

export function fetchSplitGatesForStage(
  stageId: string,
): Promise<SplitGateInfo[]> {
  return apiFetch(`/classification/stages/${stageId}/split-gates`);
}

export function fetchVehicles(): Promise<Vehicle[]> {
  return apiFetch('/vehicles');
}

export function createVehicle(input: {
  startNumber: string;
  driverName: string;
  coDriverName?: string;
  transponderId?: string;
}): Promise<Vehicle> {
  return postJson('/vehicles', input);
}

export function updateVehicle(
  id: string,
  patch: Partial<Omit<Vehicle, 'id'>>,
): Promise<Vehicle> {
  return apiFetch(`/vehicles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function fetchRallyInfo(): Promise<RallyInfo | null> {
  return apiFetch('/rally-info');
}

export function saveRallyInfo(input: RallyInfo): Promise<RallyInfo> {
  return apiFetch('/rally-info', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function fetchSetting(key: string): Promise<string | null> {
  return apiFetch<{ key: string; value: string } | null>(
    `/settings/${key}`,
  ).then((setting) => setting?.value ?? null);
}

export function saveSetting(key: string, value: string): Promise<void> {
  return apiFetch(`/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  }).then(() => undefined);
}

export function createStageRun(input: {
  vehicleId: string;
  stageId: string;
  startTime: string;
}): Promise<StageRun> {
  return postJson('/stage-runs', input);
}

export function fetchGates(): Promise<Gate[]> {
  return apiFetch('/gates');
}

export function upsertGate(id: string, input: { name: string }): Promise<Gate> {
  return apiFetch(`/gates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteGate(id: string): Promise<void> {
  return apiFetch(`/gates/${id}`, { method: 'DELETE' });
}

export function fetchGateAssignments(): Promise<GateAssignment[]> {
  return apiFetch('/gate-assignments');
}

export function createGateAssignment(assignment: {
  gateId: string;
  stageId: string;
  role: string;
  splitIndex?: number;
}): Promise<GateAssignment> {
  return postJson('/gate-assignments', assignment);
}

export function activateGateAssignment(id: string): Promise<GateAssignment> {
  return apiFetch(`/gate-assignments/${id}/activate`, { method: 'POST' });
}

export function deactivateGateAssignment(id: string): Promise<GateAssignment> {
  return apiFetch(`/gate-assignments/${id}/deactivate`, { method: 'POST' });
}

export function deleteGateAssignment(id: string): Promise<void> {
  return apiFetch(`/gate-assignments/${id}`, { method: 'DELETE' });
}

export function fetchSplitClassification(
  stageId: string,
  splitIndex: number,
): Promise<SplitClassificationEntry[]> {
  return apiFetch(`/classification/stages/${stageId}/splits/${splitIndex}`);
}

export function fetchNonFinishers(
  stageId: string,
): Promise<StageOutcomeEntry[]> {
  return apiFetch(`/classification/stages/${stageId}/non-finishers`);
}

export function closeStage(stageId: string): Promise<Stage> {
  return apiFetch(`/stages/${stageId}/close`, { method: 'POST' });
}

export function correctStageRun(
  id: string,
  patch: { startTime?: string; finishTime?: string | null },
): Promise<StageRun> {
  return apiFetch(`/stage-runs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function deleteStageRun(id: string): Promise<void> {
  return apiFetch(`/stage-runs/${id}`, { method: 'DELETE' });
}
