import { t } from '@rally-gate/ui';
import { ref } from 'vue';
import { API_BASE, apiFetch, deleteRequest, postJson } from './client';

export interface EventFile {
  file: string;
  modifiedAt: string;
}

export interface EventInfo {
  /** The open event: a file name, or the Postgres database name. Null in
   *  the lobby. */
  file: string | null;
  /** What a restart would open: the lobby's "Continue with". */
  last: string | null;
  /** False when the event is fixed by config (DB_PATH, Postgres, dev loop). */
  switchable: boolean;
  events: EventFile[];
}

export function fetchEventInfo(): Promise<EventInfo> {
  return apiFetch('/event');
}

export function createEvent(input: {
  name: string;
  date: string;
}): Promise<{ file: string }> {
  return postJson('/event', input);
}

export function openEvent(file: string): Promise<{ file: string }> {
  return postJson('/event/open', { file });
}

/** A consistent copy, also of the open event; organiser only. */
export const downloadUrl = (file: string) =>
  `${API_BASE}/event/${encodeURIComponent(file)}/download`;

/** Lands in the folder, not opened. `replace` overwrites one of that name. */
export function importEvent(
  file: File,
  replace: boolean,
): Promise<{ file: string }> {
  const query = new URLSearchParams({ file: file.name });
  if (replace) query.set('replace', 'true');
  return apiFetch(`/event/import?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
}

export function deleteEvent(file: string): Promise<void> {
  return deleteRequest(`/event/${encodeURIComponent(file)}`);
}

/** The event being switched to, for `EventSwitchOverlay`. */
export const switchingTo = ref<string | null>(null);

/**
 * Loads `path` afresh (the current page by default) once the server is back
 * on the new event: every page holds the old event's data.
 */
export async function switchEvent(
  request: () => Promise<{ file: string }>,
  path?: string,
): Promise<void> {
  const { file } = await request();
  switchingTo.value = file;
  try {
    await waitForEvent(file);
  } catch (err) {
    switchingTo.value = null;
    throw err;
  }
  if (path) location.assign(path);
  else location.reload();
}

/**
 * Switching restarts the server, so the request answers before the new event
 * is open. Resolves once the server is back on `file`.
 */
async function waitForEvent(file: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      if ((await fetchEventInfo()).file === file) return;
    } catch {
      // still restarting
    }
  }
  throw new Error(t('setup.serverNotBack', { file }));
}

/** Gates this computer remembers across events (standalone only). */
export interface KnownGate {
  id: string;
  name: string;
}

export function fetchKnownGates(): Promise<KnownGate[]> {
  return apiFetch('/event/known-gates');
}

export function forgetKnownGate(id: string): Promise<void> {
  return deleteRequest(`/event/known-gates/${id}`);
}
