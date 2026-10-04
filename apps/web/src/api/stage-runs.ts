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
  /** Hand-set (Start now / Finish now / a correction) rather than gate-timed. */
  startManual: boolean;
  finishManual: boolean;
}

export interface StageSplit {
  id: string;
  stageRunId: string;
  gateId: string;
  splitIndex: number;
  timestamp: string;
  elapsedMs: number;
}

/** Every attempt, voided ones included; of one stage, or of them all. */
export function fetchStageRuns(stageId?: string): Promise<StageRun[]> {
  return apiFetch(
    stageId
      ? `/stage-runs?stageId=${encodeURIComponent(stageId)}`
      : '/stage-runs',
  );
}

export function fetchSplitsForStage(stageId: string): Promise<StageSplit[]> {
  return apiFetch(`/stage-runs/splits?stageId=${encodeURIComponent(stageId)}`);
}

/** Without `startTime` the server stamps the start with its own clock. */
export function createStageRun(input: {
  vehicleId: string;
  stageId: string;
  startTime?: string;
  finishTime?: string;
}): Promise<StageRun> {
  return postJson('/stage-runs', input);
}

export function correctStageRun(
  id: string,
  patch: { startTime?: string; finishTime?: string | null },
): Promise<StageRun> {
  return patchJson(`/stage-runs/${id}`, patch);
}

/** Hand-timed finish, stamped by the server. 409 if already finished. */
export function finishStageRunNow(id: string): Promise<StageRun> {
  return postRequest(`/stage-runs/${id}/finish`);
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
