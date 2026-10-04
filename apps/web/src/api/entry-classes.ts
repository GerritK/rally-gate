import { apiFetch, deleteRequest, postJson, putJson } from './client';

export interface EntryClass {
  id: string;
  name: string;
  /** 4WD/2WD rather than a cross-cutting category like Rookie. */
  main: boolean;
}

export function fetchEntryClasses(): Promise<EntryClass[]> {
  return apiFetch('/entry-classes');
}

/** 409 if the name is taken. */
export function createEntryClass(input: {
  name: string;
  main: boolean;
}): Promise<EntryClass> {
  return postJson('/entry-classes', input);
}

export function updateEntryClass(
  id: string,
  input: { name: string; main: boolean },
): Promise<EntryClass> {
  return putJson(`/entry-classes/${id}`, input);
}

/** Takes the class off every entry in it; no runs are touched. */
export function deleteEntryClass(id: string): Promise<void> {
  return deleteRequest(`/entry-classes/${id}`);
}
