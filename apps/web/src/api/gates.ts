import type { GatePairingState, GatePowerOffResult } from '@rally-gate/shared';
import {
  API_BASE,
  apiFetch,
  deleteRequest,
  postRequest,
  putJson,
} from './client';

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
  /** The gate's NTP sync; null when the gate can't report it. */
  ntpSynced?: boolean | null;
  /** RMS of the gate's recent NTP offsets, ms. */
  ntpOffsetMs?: number | null;
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

export function fetchGatePairing(): Promise<GatePairingState> {
  return apiFetch('/gate-pairing');
}

/** Open for 10 minutes from now. */
export function openGatePairing(): Promise<GatePairingState> {
  return postRequest('/gate-pairing');
}

export function acceptWaitingGate(gateId: string): Promise<GatePairingState> {
  return postRequest(`/gate-pairing/${gateId}`);
}

export function rejectWaitingGate(gateId: string): Promise<void> {
  return deleteRequest(`/gate-pairing/${gateId}`);
}

/** A link, not a fetch: the server answers with a redirect to the gate's page and a pass (`docs/auth.md` "gate-config"). */
export function gateConfigureUrl(gateId: string): string {
  return `${API_BASE}/gates/${encodeURIComponent(gateId)}/configure`;
}
