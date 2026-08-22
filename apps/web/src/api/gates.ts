import { apiFetch, deleteRequest, putJson } from './client';

export interface Gate {
  id: string;
  name: string;
  lastHeartbeatAt?: string;
  capabilities?: string;
  /**
   * Measured gap between this gate's clock and the server's, in ms.
   * Positive = the gate is behind. Null until a heartbeat carrying `sentAt`
   * arrives (an older gate-agent never reports one).
   */
  clockOffsetMs?: number | null;
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
