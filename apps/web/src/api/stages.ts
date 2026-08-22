import { StageStatus } from '@rally-gate/shared';
import { apiFetch, postJson, postRequest, putJson } from './client';

export interface Stage {
  id: string;
  name: string;
  stageNumber: number;
  status: StageStatus;
}

export function fetchStages(): Promise<Stage[]> {
  return apiFetch('/stages');
}

export function fetchStage(id: string): Promise<Stage> {
  return apiFetch(`/stages/${id}`);
}

/** Creates a new stage. Rejects (409) if `id` or `stageNumber` is already taken. */
export function createStage(stage: Stage): Promise<Stage> {
  return postJson('/stages', stage);
}

/** Updates an existing stage. 404s if `id` doesn't exist, 409s if `stageNumber` clashes with another stage. */
export function upsertStage(
  id: string,
  input: { name: string; stageNumber: number; status: StageStatus },
): Promise<Stage> {
  return putJson(`/stages/${id}`, input);
}

/** Closes the stage — also deactivates its gates in one step (see `docs/architecture.md`). */
export function closeStage(stageId: string): Promise<Stage> {
  return postRequest(`/stages/${stageId}/close`);
}

/**
 * Makes this stage's gates live and flips its status to `ACTIVE`. Throws
 * `ApiError` with status 409 and `body.conflictingStageIds` if another stage
 * is already active on a shared gate — pass `force: true` to deactivate
 * that other stage instead. 409s with a plain message (no
 * `conflictingStageIds`) if the stage is already `CLOSED` — closing is
 * terminal.
 */
export function activateStage(stageId: string, force = false): Promise<Stage> {
  return postRequest(
    `/stages/${stageId}/activate${force ? '?force=true' : ''}`,
  );
}
