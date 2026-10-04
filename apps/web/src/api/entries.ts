import { EntryStatus, type Crew } from '@rally-gate/shared';
import { apiFetch, patchJson, postJson } from './client';
import type { EntryClass } from './entry-classes';

export { EntryStatus };

export interface Entry extends Crew {
  id: string;
  startNumber: number;
  chassis: string | null;
  body: string | null;
  transponderId?: string | null;
  status: EntryStatus;
  classes: EntryClass[];
}

/** Classes are written by id and read back as objects. */
export type EntryPatch = Partial<Omit<Entry, 'id' | 'classes'>> & {
  classIds?: string[];
};

export function fetchEntries(): Promise<Entry[]> {
  return apiFetch('/entries');
}

export function fetchEntry(id: string): Promise<Entry | null> {
  return apiFetch(`/entries/${id}`);
}

export function createEntry(
  input: EntryPatch & { startNumber: number; driverFirstName: string },
): Promise<Entry> {
  return postJson('/entries', input);
}

export function updateEntry(id: string, patch: EntryPatch): Promise<Entry> {
  return patchJson(`/entries/${id}`, patch);
}
