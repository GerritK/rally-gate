import { apiFetch, postJson } from './client';

export interface EventFile {
  file: string;
  modifiedAt: string;
}

export interface EventInfo {
  /** The open event: a file name, or the Postgres database name. */
  file: string;
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

/**
 * Switching restarts the server, so the request answers before the new event
 * is open. Resolves once the server is back on `file`.
 */
export async function waitForEvent(file: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      if ((await fetchEventInfo()).file === file) return;
    } catch {
      // still restarting
    }
  }
  throw new Error(`The server did not come back with ${file}`);
}
