import {
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * The exit code that asks `deploy/standalone/start.js` to start the server
 * again. Switching events is a restart, because TypeORM's DataSource is wired
 * into every repository at boot and can't be swapped underneath them. Keep in
 * step with start.js.
 */
export const RESTART_EXIT_CODE = 75;

const EXTENSION = '.rallygate';
const POINTER = 'current.json';
/** Generous: a rally's file is a few MB. */
export const IMPORT_MAX_BYTES = 100 * 1024 * 1024;
/** SQLite's side files of an event file, deleted with it. */
const SIDE_FILES = ['-wal', '-shm', '-journal'];

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
 * Whether to boot without an event, for the organiser to pick one: asked for
 * by the launcher on the first start only (a restart into a switched event
 * must not stop there), or nothing to open. Never with the event fixed by
 * config.
 */
export function startsInLobby(): boolean {
  const dir = eventsDir();
  return !!dir && (process.env.LOBBY === '1' || !resolveEventFile(dir));
}

/**
 * The pointer's file if it still exists, else the most recently used one —
 * a deleted or hand-edited pointer must never stop the server from starting
 * mid-event. Null for an empty folder.
 */
export function resolveEventFile(dir: string): string | null {
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
  return listEventFiles(dir)[0]?.file ?? null;
}

export function writeCurrentEventFile(dir: string, file: string): void {
  writeFileSync(join(dir, POINTER), JSON.stringify({ file }, null, 2));
}

/** `file` must have passed `isEventFile`. */
export function deleteEventFile(dir: string, file: string): void {
  for (const suffix of ['', ...SIDE_FILES]) {
    rmSync(join(dir, file + suffix), { force: true });
  }
}

/** Only a plain name listed in `dir` — never a path from a request. */
export function isEventFile(dir: string, file: string): boolean {
  return listEventFiles(dir).some((event) => event.file === file);
}

/**
 * `2026-10-12 Rallye Eifel.rallygate`. The date prefix sorts the folder and
 * also keeps a name like `CON` from ever being a bare Windows device name.
 * Null when nothing usable is left of the name.
 */
export function eventFileName(date: string, name: string): string | null {
  const safe = safeName(name);
  return safe ? `${date} ${safe}${EXTENSION}` : null;
}

/**
 * An uploaded file's name as an event file in the folder: its last path
 * segment, cleaned like a new event's, with our extension. Null when
 * nothing usable is left.
 */
export function importFileName(uploaded: string): string | null {
  const last = uploaded.split(/[\\/]/).pop() ?? '';
  const safe = safeName(last.replace(/\.rallygate$/i, ''));
  return safe ? `${safe}${EXTENSION}` : null;
}

/** The event name without the extension, as a marshal named it. */
export function eventName(file: string): string {
  return file.endsWith(EXTENSION) ? file.slice(0, -EXTENSION.length) : file;
}

function safeName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/[. ]+$/, '')
      .trim()
  );
}
