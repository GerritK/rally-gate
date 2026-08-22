import { StageStatus } from '@rally-gate/shared';
import {
  apiFetch,
  deleteRequest,
  postJson,
  postRequest,
  putJson,
} from './client';

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

/**
 * Creates a new stage. Rejects (409) if `id` or `stageNumber` is already
 * taken, (400) if `id` isn't URL-safe.
 *
 * No `status`: it's server-owned and always starts NOT_STARTED. Sending it is
 * a 400 — lifecycle moves only through `activateStage`/`closeStage`, so that
 * gate assignments stay in step with it (see `docs/architecture.md`).
 */
export function createStage(input: {
  id: string;
  name: string;
  stageNumber: number;
}): Promise<Stage> {
  return postJson('/stages', input);
}

/**
 * Updates an existing stage. 404s if `id` doesn't exist, 409s if
 * `stageNumber` clashes with another stage or the stage isn't NOT_STARTED.
 * `status` is not settable here — see `createStage`.
 */
export function upsertStage(
  id: string,
  input: { name: string; stageNumber: number },
): Promise<Stage> {
  return putJson(`/stages/${id}`, input);
}

/** Deletes the stage and its gate assignments. 409s unless the stage is still NOT_STARTED. */
export function deleteStage(stageId: string): Promise<void> {
  return deleteRequest(`/stages/${stageId}`);
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
