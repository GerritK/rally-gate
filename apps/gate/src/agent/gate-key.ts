import { GATE_KEY_PASSWORD_PREFIX } from '@rally-gate/shared';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const TOKEN_LIFETIME_MS = 60_000;

/** The key at `path` (64 hex), created there on first use. */
export function loadGateKey(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    const key = randomBytes(32).toString('hex');
    mkdirSync(dirname(path), { recursive: true });
    // `wx`: never overwrite a key that appeared meanwhile.
    writeFileSync(path, `${key}\n`, { mode: 0o600, flag: 'wx' });
    return key;
  }
}

/**
 * The MQTT password: a token that proves the key without sending it, or the
 * key itself when the broker asked for it (CONNACK 4, pairing open).
 */
export function gatePassword(
  key: string,
  gateId: string,
  sendKey: boolean,
  now = Date.now(),
): string {
  if (sendKey) {
    return `${GATE_KEY_PASSWORD_PREFIX}${key}`;
  }
  const expiry = now + TOKEN_LIFETIME_MS;
  const mac = createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`${gateId}.${expiry}`)
    .digest('hex');
  return `${expiry}.${mac}`;
}
