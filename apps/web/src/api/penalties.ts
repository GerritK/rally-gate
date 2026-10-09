import type { PenaltyScope, PenaltyTier } from '@rally-gate/shared';
import { apiFetch, deleteRequest, postJson, putJson } from './client';

export interface PenaltyType {
  id: string;
  name: string;
  scope: PenaltyScope;
  /** From 1, ascending; one tier is a flat price per offence. */
  tiers: PenaltyTier[];
}

export interface Penalty {
  id: string;
  entryId: string;
  /** Null: for the whole rally. */
  stageId: string | null;
  /** Null: free text, priced by `seconds`. */
  typeId: string | null;
  count: number;
  seconds: number | null;
  note: string | null;
  createdAt: string;
  /** Computed: depends on the entry's other penalties of the type. */
  penaltyMs: number;
}

export type PenaltyTypeInput = Omit<PenaltyType, 'id'>;

export interface PenaltyInput {
  entryId: string;
  stageId: string | null;
  typeId: string | null;
  count: number;
  seconds: number | null;
  note: string | null;
}

export function fetchPenaltyTypes(): Promise<PenaltyType[]> {
  return apiFetch('/penalty-types');
}

/** 409 if the name is taken. */
export function createPenaltyType(
  input: PenaltyTypeInput,
): Promise<PenaltyType> {
  return postJson('/penalty-types', input);
}

export function updatePenaltyType(
  id: string,
  input: PenaltyTypeInput,
): Promise<PenaltyType> {
  return putJson(`/penalty-types/${id}`, input);
}

/** Deletes every penalty of the type too. */
export function deletePenaltyType(id: string): Promise<void> {
  return deleteRequest(`/penalty-types/${id}`);
}

export function fetchPenalties(entryId: string): Promise<Penalty[]> {
  return apiFetch(`/penalties?entryId=${entryId}`);
}

/** 409 on a stage that hasn't started. */
export function createPenalty(input: PenaltyInput): Promise<Penalty> {
  return postJson('/penalties', input);
}

export function deletePenalty(id: string): Promise<void> {
  return deleteRequest(`/penalties/${id}`);
}
