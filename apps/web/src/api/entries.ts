import {
  EntryStatus,
  type Crew,
  type TransponderKind,
} from '@rally-gate/shared';
import { apiFetch, patchJson, postJson } from './client';
import type { EntryClass } from './entry-classes';

export { EntryStatus };

export interface Entry extends Crew {
  id: string;
  startNumber: number;
  transponders: EntryTransponder[];
  status: EntryStatus;
  classes: EntryClass[];
}

export interface EntryTransponder {
  id: string;
  kind: TransponderKind;
  identifier: string;
  label: string | null;
}

export type TransponderInput = Omit<EntryTransponder, 'id'>;

/** Classes are written by id and read back as objects; transponders are
 *  written as a whole list, which replaces the entry's. */
export type EntryPatch = Partial<
  Omit<Entry, 'id' | 'classes' | 'transponders'>
> & {
  classIds?: string[];
  transponders?: TransponderInput[];
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
