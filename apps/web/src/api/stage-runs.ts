import { StageRunStatus } from '@rally-gate/shared';
import {
  apiFetch,
  deleteRequest,
  patchJson,
  postJson,
  postRequest,
} from './client';

export interface StageRun {
  id: string;
  vehicleId: string;
  stageId: string;
  startTime: string;
  finishTime?: string;
  durationMs?: number;
  status: StageRunStatus;
  /** 1 for a first run, incrementing per re-run. Highest surviving attempt counts. */
  attempt: number;
  /** Struck out by a marshal (red flag) — kept as evidence, counts for nothing. */
  voided: boolean;
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

/**
 * Strikes out an attempt after a red flag. The row is kept as evidence but
 * stops counting, and the vehicle is freed so the start gate opens the
 * re-run itself on its next pass — no hand-entered restart time.
 */
export function voidStageRun(id: string): Promise<StageRun> {
  return postRequest(`/stage-runs/${id}/void`);
}

/**
 * Reverses a void. Throws `ApiError` 409 with `body.blockingAttempt` if
 * another attempt already counts for that stage — a vehicle has at most one
 * non-voided attempt, so that one must be voided first. Deliberately not a
 * cascade: discarding the other run is the marshal's call to make explicitly.
 */
export function unvoidStageRun(id: string): Promise<StageRun> {
  return postRequest(`/stage-runs/${id}/unvoid`);
}

export function fetchSplitsForRun(stageRunId: string): Promise<StageSplit[]> {
  return apiFetch(`/stage-runs/${stageRunId}/splits`);
}
