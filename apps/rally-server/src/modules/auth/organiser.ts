import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toString as qrToString } from 'qrcode';
import { lanAddresses } from '../discovery/discovery.service';
import { eventsDir } from '../event-files/event-files';

/**
 * Outside the event database, so the password survives switching events.
 * Postgres has no events folder, hence `CONFIG_DIR` (a volume in
 * `deploy/docker-compose.yml`).
 */
export function organiserFile(): string {
  return join(
    process.env.CONFIG_DIR || eventsDir() || process.cwd(),
    'organiser.json',
  );
}

interface OrganiserFile {
  /** `salt:hash`, scrypt, both hex. */
  passwordHash?: string;
  /** For the `/setup?t=` link while no password is set. */
  setupToken?: string;
}

// Read on every use, not cached: `npm run reset-admin` changes it under a
// running server.
function read(): OrganiserFile {
  const path = organiserFile();
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as OrganiserFile)
    : {};
}

function write(file: OrganiserFile): void {
  writeFileSync(organiserFile(), `${JSON.stringify(file, null, 2)}\n`);
}

export function passwordSet(): boolean {
  return !!read().passwordHash;
}

export function verifyPassword(password: string): boolean {
  const [salt, hash] = (read().passwordHash ?? '').split(':');
  if (!salt || !hash) return false;
  return timingSafeEqual(
    Buffer.from(hash, 'hex'),
    scryptSync(password, salt, 32),
  );
}

/** Also ends the setup link: it was only for setting the first password. */
export function setPassword(password: string): void {
  const salt = randomBytes(16).toString('hex');
  write({
    passwordHash: `${salt}:${scryptSync(password, salt, 32).toString('hex')}`,
  });
}

export function setupTokenMatches(token: string): boolean {
  const { setupToken, passwordHash } = read();
  if (!setupToken || passwordHash) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(token), digest(setupToken));
}

/**
 * Forgets the password and makes a new setup link: first start, or
 * `npm run reset-admin`. Keeps an existing link while no password is set, so
 * a restart doesn't void a QR code someone is about to scan.
 */
export function ensureSetupToken(reset = false): string {
  const file = read();
  if (!reset && file.setupToken && !file.passwordHash) return file.setupToken;
  const setupToken = randomBytes(16).toString('base64url');
  write({ setupToken });
  return setupToken;
}

/**
 * The LAN IP, not `rally-server.local`: Android resolves `.local`
 * unreliably. One link per address, since which one a phone reaches is
 * unknown here.
 */
export async function setupInstructions(token: string): Promise<string> {
  const port = process.env.PORT ?? 57430;
  const urls = (lanAddresses().length ? lanAddresses() : ['localhost']).map(
    (ip) => `http://${ip}:${port}/setup?t=${token}`,
  );
  const qr = await qrToString(urls[0], { type: 'terminal', small: true });
  return [
    'No organiser password yet. Scan this QR code with a phone on the rally network to set it:',
    qr,
    ...urls,
  ].join('\n');
}
