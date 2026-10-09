import { apiFetch, deleteRequest, postRequest, putJson } from './client';

export interface Gate {
  id: string;
  name: string;
  lastHeartbeatAt?: string;
  capabilities?: string;
  version?: string;
  /** Where its MQTT connection comes from, i.e. where gate-config listens. */
  address?: string;
  /**
   * Measured gap between this gate's clock and the server's, in ms.
   * Positive = the gate is behind. Null until a heartbeat carrying `sentAt`
   * arrives (an older gate-agent never reports one).
   */
  clockOffsetMs?: number | null;
  /** chrony on the gate; null when the gate can't read it. */
  chronySynced?: boolean | null;
  /** chrony's own offset estimate, absolute ms. */
  chronyOffsetMs?: number | null;
}

export interface GatePowerOffResult {
  gateId: string;
  ok: boolean;
  message?: string;
}

export function fetchGates(): Promise<Gate[]> {
  return apiFetch('/gates');
}

/** Null for an id no gate has. */
export function fetchGate(id: string): Promise<Gate | null> {
  return apiFetch(`/gates/${id}`);
}

export function upsertGate(id: string, input: { name: string }): Promise<Gate> {
  return putJson(`/gates/${id}`, input);
}

export function deleteGate(id: string, force = false): Promise<void> {
  return deleteRequest(`/gates/${id}${force ? '?force=true' : ''}`);
}

/** 409 while a stage is active. */
export function powerOffAllGates(): Promise<GatePowerOffResult[]> {
  return postRequest('/gates/power-off');
}
