import { apiFetch, deleteRequest, putJson } from './client';

export interface Gate {
  id: string;
  name: string;
  lastHeartbeatAt?: string;
  capabilities?: string;
}

export function fetchGates(): Promise<Gate[]> {
  return apiFetch('/gates');
}

export function upsertGate(id: string, input: { name: string }): Promise<Gate> {
  return putJson(`/gates/${id}`, input);
}

export function deleteGate(id: string, force = false): Promise<void> {
  return deleteRequest(`/gates/${id}${force ? '?force=true' : ''}`);
}
