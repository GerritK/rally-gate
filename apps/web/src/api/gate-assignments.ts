import { GateRole } from '@rally-gate/shared';
import { apiFetch, deleteRequest, postJson } from './client';

export const GATE_ROLES = Object.values(GateRole);

export interface GateAssignment {
  id: string;
  gateId: string;
  stageId: string;
  role: GateRole;
  splitIndex?: number;
  active: boolean;
}

export function fetchGateAssignments(): Promise<GateAssignment[]> {
  return apiFetch('/gate-assignments');
}

export function createGateAssignment(assignment: {
  gateId: string;
  stageId: string;
  role: GateRole;
  splitIndex?: number;
}): Promise<GateAssignment> {
  return postJson('/gate-assignments', assignment);
}

export function deleteGateAssignment(id: string): Promise<void> {
  return deleteRequest(`/gate-assignments/${id}`);
}
