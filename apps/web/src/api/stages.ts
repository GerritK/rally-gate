import { StageStatus } from '@rally-gate/shared';
import { apiFetch, postRequest, putJson } from './client';

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

export function upsertStage(
  id: string,
  input: { name: string; stageNumber: number; status: StageStatus },
): Promise<Stage> {
  return putJson(`/stages/${id}`, input);
}

export function closeStage(stageId: string): Promise<Stage> {
  return postRequest(`/stages/${stageId}/close`);
}
