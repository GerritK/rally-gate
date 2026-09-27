import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The exit code that asks `deploy/standalone/start.js` to start the server
 * again. Switching events is a restart, because TypeORM's DataSource is wired
 * into every repository at boot and can't be swapped underneath them. Keep in
 * step with start.js.
 */
export const RESTART_EXIT_CODE = 75;

const EXTENSION = '.sqlite';
const POINTER = 'current.json';
/** What the packages used before there was more than one event file, so an
 * existing install keeps opening its data. */
const DEFAULT_FILE = `rally-gate${EXTENSION}`;

export interface EventFile {
  file: string;
  modifiedAt: string;
}

/**
 * The folder of event files, or null when the event is fixed by config:
 * `DB_PATH`, Postgres, or a server not started by the standalone launcher —
 * which is the only thing that restarts it after a switch.
 */
export function eventsDir(): string | null {
  if (process.env.DB_PATH || process.env.DB_TYPE === 'postgres') {
    return null;
  }
  return process.env.EVENTS_DIR || null;
}

export function listEventFiles(dir: string): EventFile[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(EXTENSION))
    .map((file) => ({
      file,
      modifiedAt: statSync(join(dir, file)).mtime.toISOString(),
    }))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/**
 * The pointer's file if it still exists, else the most recently used one —
 * a deleted or hand-edited pointer must never stop the server from starting
 * mid-event.
 */
export function resolveEventFile(dir: string): string {
  try {
    const { file } = JSON.parse(readFileSync(join(dir, POINTER), 'utf8')) as {
      file?: unknown;
    };
    if (typeof file === 'string' && isEventFile(dir, file)) {
      return file;
    }
  } catch {
    // no or unreadable pointer
  }
  return listEventFiles(dir)[0]?.file ?? DEFAULT_FILE;
}

export function writeCurrentEventFile(dir: string, file: string): void {
  writeFileSync(join(dir, POINTER), JSON.stringify({ file }, null, 2));
}

/** Only a plain name listed in `dir` — never a path from a request. */
export function isEventFile(dir: string, file: string): boolean {
  return listEventFiles(dir).some((event) => event.file === file);
}

/**
 * `2026-10-12 Rallye Eifel.sqlite`. The date prefix sorts the folder and
 * also keeps a name like `CON` from ever being a bare Windows device name.
 * Null when nothing usable is left of the name.
 */
export function eventFileName(date: string, name: string): string | null {
  const safe = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/[. ]+$/, '')
    .trim();
  return safe ? `${date} ${safe}${EXTENSION}` : null;
}
