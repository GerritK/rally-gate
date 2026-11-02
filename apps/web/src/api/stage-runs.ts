import type { DidNotStart, StageRunStatus } from '@rally-gate/shared';
import {
  apiFetch,
  deleteRequest,
  patchJson,
  postJson,
  postRequest,
} from './client';

export interface StageRun {
  id: string;
  entryId: string;
  stageId: string;
  startTime: string;
  finishTime?: string;
  durationMs?: number;
  status: StageRunStatus;
  /** 1 for a first run, incrementing per re-run. Highest surviving attempt counts. */
  attempt: number;
  /** Struck out by a marshal (red flag) — kept as evidence, counts for nothing. */
  voided: boolean;
  /** DNF on this stage: by a marshal, or the stage closed with it open. */
  dnf: boolean;
  /** Hand-set (Start now / Finish now / a correction) rather than gate-timed. */
  startManual: boolean;
  finishManual: boolean;
  /** The slot on a slot stage, also its start time; null when gate-started. */
  plannedStartTime: string | null;
  /** The earliest start passing on a slot stage: the jump-start evidence. */
  startPassingAt: string | null;
  jumpStartDismissed: boolean;
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
  entryId: string;
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

/** The Countdown button: queues the car's slot. 409 if it is queued, on
 *  stage, or finished a counted stage. */
export function startCountdown(input: {
  entryId: string;
  stageId: string;
}): Promise<StageRun> {
  return postJson('/stage-runs/countdown', input);
}

/** 409 once the car passed the start. */
export function cancelCountdown(id: string): Promise<void> {
  return postRequest(`/stage-runs/${id}/cancel-countdown`);
}

/** No penalty for this jump start; the mark stays. */
export function dismissJumpStart(id: string): Promise<StageRun> {
  return postRequest(`/stage-runs/${id}/dismiss-jump-start`);
}

export function deleteStageRun(id: string): Promise<void> {
  return deleteRequest(`/stage-runs/${id}`);
}

/**
 * Strikes out an attempt after a red flag. The row is kept as evidence but
 * stops counting, and the entry is freed so the start gate opens the
 * re-run itself on its next pass — no hand-entered restart time.
 */
export function voidStageRun(id: string): Promise<StageRun> {
  return postRequest(`/stage-runs/${id}/void`);
}

/**
 * Reverses a void. Throws `OTHER_ATTEMPT_COUNTS` if
 * another attempt already counts for that stage — an entry has at most one
 * non-voided attempt, so that one must be voided first. Deliberately not a
 * cascade: discarding the other run is the marshal's call to make explicitly.
 */
export function unvoidStageRun(id: string): Promise<StageRun> {
  return postRequest(`/stage-runs/${id}/unvoid`);
}

/** DNF on the stage, at once. */
export function markDnf(id: string): Promise<StageRun> {
  return postRequest(`/stage-runs/${id}/dnf`);
}

/** Until the stage closes. */
export function undoDnf(id: string): Promise<StageRun> {
  return postRequest(`/stage-runs/${id}/dnf/undo`);
}

/** DNS rows, of one stage or all. */
export function fetchDns(stageId?: string): Promise<DidNotStart[]> {
  return apiFetch(
    stageId
      ? `/stage-runs/dns?stageId=${encodeURIComponent(stageId)}`
      : '/stage-runs/dns',
  );
}

/** Only without a counting run; deletes an untouched slot run. */
export function markDns(row: DidNotStart): Promise<void> {
  return postJson('/stage-runs/dns', row);
}

/** Until the stage closes. */
export function undoDns(row: DidNotStart): Promise<void> {
  return postJson('/stage-runs/dns/undo', row);
}
