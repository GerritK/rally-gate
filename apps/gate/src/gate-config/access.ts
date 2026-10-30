import {
  GATE_CONFIG_PASS_LIFETIME_MS,
  gateConfigPassMessage,
} from '@rally-gate/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'rally_gate_session';
export const SESSION_LIFETIME_MS = 60 * 60_000;
export const POWER_ON_WINDOW_MS = 3 * 60_000;
/** As the server allows a broker token: for a clock that hasn't synced yet. */
const CLOCK_SLACK_MS = 10_000;

function mac(key: string, message: string): Buffer {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(message).digest();
}

/** `<expiryMs>.<hex mac>` signed for `message(expiry)`, not expired and not too far ahead. */
function validSigned(
  key: string,
  value: string,
  message: (expiry: number) => string,
  lifetimeMs: number,
  now: number,
): boolean {
  const [expiryText, hex] = value.split('.');
  const expiry = Number(expiryText);
  if (
    !Number.isSafeInteger(expiry) ||
    !/^[0-9a-f]{64}$/.test(hex ?? '') ||
    expiry < now - CLOCK_SLACK_MS ||
    expiry > now + lifetimeMs + CLOCK_SLACK_MS
  ) {
    return false;
  }
  return timingSafeEqual(mac(key, message(expiry)), Buffer.from(hex, 'hex'));
}

/** The `?t=` from "Configure" on the dashboard's Hardware page. */
export function validPass(
  key: string,
  gateId: string,
  pass: string,
  now = Date.now(),
): boolean {
  return validSigned(
    key,
    pass,
    (expiry) => gateConfigPassMessage(gateId, expiry),
    GATE_CONFIG_PASS_LIFETIME_MS,
    now,
  );
}

/** Stateless, so it survives a restart of gate-config. */
export function newSession(key: string, now = Date.now()): string {
  const expiry = now + SESSION_LIFETIME_MS;
  return `${expiry}.${mac(key, `session.${expiry}`).toString('hex')}`;
}

export function validSession(
  key: string,
  cookie: string,
  now = Date.now(),
): boolean {
  return validSigned(
    key,
    cookie,
    (expiry) => `session.${expiry}`,
    SESSION_LIFETIME_MS,
    now,
  );
}
