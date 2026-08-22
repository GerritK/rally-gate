import { StageRunStatus } from '@rally-gate/shared';
import { apiFetch, deleteRequest, patchJson, postJson } from './client';

export interface StageRun {
  id: string;
  vehicleId: string;
  stageId: string;
  startTime: string;
  finishTime?: string;
  durationMs?: number;
  status: StageRunStatus;
}

export interface StageSplit {
  id: string;
  stageRunId: string;
  gateId: string;
  splitIndex: number;
  timestamp: string;
  elapsedMs: number;
}

export function fetchStageRuns(): Promise<StageRun[]> {
  return apiFetch('/stage-runs');
}

export function createStageRun(input: {
  vehicleId: string;
  stageId: string;
  startTime: string;
}): Promise<StageRun> {
  return postJson('/stage-runs', input);
}

export function correctStageRun(
  id: string,
  patch: { startTime?: string; finishTime?: string | null },
): Promise<StageRun> {
  return patchJson(`/stage-runs/${id}`, patch);
}

export function deleteStageRun(id: string): Promise<void> {
  return deleteRequest(`/stage-runs/${id}`);
}

export function fetchSplitsForRun(stageRunId: string): Promise<StageSplit[]> {
  return apiFetch(`/stage-runs/${stageRunId}/splits`);
}
