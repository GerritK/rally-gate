import {
  ApiErrorCode,
  GATE_CONFIG_PASS_LIFETIME_MS,
  GATE_ID_PATTERN,
  GATE_KEY_PASSWORD_PREFIX,
  gateConfigPassMessage,
  GatePairingState,
  WaitingGate,
} from '@rally-gate/shared';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiError } from '../../common/api-error';
import { configDir } from '../auth/organiser';

const PAIRING_WINDOW_MS = 10 * 60_000;
const MAX_WAITING = 20;
const TOKEN_LIFETIME_MS = 60_000;
/** For a gate whose clock hasn't synced yet. */
const CLOCK_SLACK_MS = 10_000;
/** A refused gate retries every few seconds; the log names it once in this. */
const REFUSAL_LOG_INTERVAL_MS = 10 * 60_000;
const HEX_KEY = /^[0-9a-f]{64}$/;

/** What the broker answers a gate's CONNECT with. */
export enum GateLogin {
  ACCEPTED = 'accepted',
  /** CONNACK 4: pairing is open and the key is unknown, send it. */
  SEND_KEY = 'sendKey',
  /** CONNACK 5. */
  REFUSED = 'refused',
}

/**
 * The gates' keys and pairing (`docs/auth.md` "Gates"). Keys live in
 * `gate-keys.json` next to `organiser.json`, outside the event, so an approved
 * gate logs in to every event on this server. Pairing and the waiting gates
 * are memory only: a restart closes pairing, and a waiting gate sends its key
 * again once it reopens.
 */
@Injectable()
export class GatePairingService implements OnModuleInit {
  private readonly logger = new Logger(GatePairingService.name);
  private readonly autoAccept = process.env.GATES_AUTO_ACCEPT === '1';
  private keys: Record<string, string> = {};
  private closesAt = 0;
  private readonly waiting = new Map<string, WaitingGate & { key: string }>();
  /** Rejected in this pairing window, so their retries don't put them back. */
  private readonly rejected = new Set<string>();
  /** Per gate, so a sniffed token can't be used again while it is valid. */
  private readonly lastExpiry = new Map<string, number>();
  private readonly lastRefusalLog = new Map<string, number>();

  constructor(private readonly emitter: EventEmitter2) {}

  onModuleInit() {
    const path = this.path();
    if (!existsSync(path)) {
      return;
    }
    try {
      this.keys = (
        JSON.parse(readFileSync(path, 'utf8')) as {
          keys: Record<string, string>;
        }
      ).keys;
    } catch (err) {
      // Not ignored silently: every gate would wait for approval again.
      this.logger.error(
        `Unreadable ${path}, no gate can log in: ${String(err)}`,
      );
    }
  }

  /** Dev only: anyone may connect without a login, as before step 2. */
  get allowsAnonymous(): boolean {
    return this.autoAccept;
  }

  login(
    gateId: string,
    password: string,
    address: string | null,
    now = Date.now(),
  ): GateLogin {
    if (!GATE_ID_PATTERN.test(gateId)) {
      return this.refuse(gateId, 'invalid gate id', now);
    }
    const known = this.keys[gateId];
    if (password.startsWith(GATE_KEY_PASSWORD_PREFIX)) {
      const key = password.slice(GATE_KEY_PASSWORD_PREFIX.length);
      if (!HEX_KEY.test(key)) {
        return this.refuse(gateId, 'malformed key', now);
      }
      if (key === known) {
        return GateLogin.ACCEPTED;
      }
      if (this.autoAccept) {
        this.saveKey(gateId, key);
        return GateLogin.ACCEPTED;
      }
      if (!this.isOpen(now) || this.rejected.has(gateId)) {
        return this.refuse(gateId, 'pairing closed', now);
      }
      const entry = this.waiting.get(gateId);
      if (!entry && this.waiting.size >= MAX_WAITING) {
        return this.refuse(gateId, 'too many gates waiting', now);
      }
      this.waiting.set(gateId, {
        gateId,
        keyChanged: !!known,
        since: entry?.since ?? new Date(now).toISOString(),
        lastAttemptAt: new Date(now).toISOString(),
        address,
        key,
      });
      this.changed();
      return GateLogin.REFUSED;
    }
    if (known && this.validToken(known, gateId, password, now)) {
      this.lastExpiry.set(gateId, Number(password.split('.')[0]));
      return GateLogin.ACCEPTED;
    }
    const entry = this.waiting.get(gateId);
    if (entry) {
      entry.lastAttemptAt = new Date(now).toISOString();
      entry.address = address;
      this.changed();
      return GateLogin.REFUSED;
    }
    if (
      (this.autoAccept || this.isOpen(now)) &&
      !this.rejected.has(gateId) &&
      this.waiting.size < MAX_WAITING
    ) {
      return GateLogin.SEND_KEY;
    }
    return this.refuse(
      gateId,
      known ? 'wrong or expired token' : 'unknown gate',
      now,
    );
  }

  /** The `?t=` that opens the gate's config page, null without its key. */
  configPass(gateId: string, now = Date.now()): string | null {
    const key = this.keys[gateId];
    if (!key) {
      return null;
    }
    const expiry = now + GATE_CONFIG_PASS_LIFETIME_MS;
    const mac = createHmac('sha256', Buffer.from(key, 'hex'))
      .update(gateConfigPassMessage(gateId, expiry))
      .digest('hex');
    return `${expiry}.${mac}`;
  }

  state(now = Date.now()): GatePairingState {
    return {
      open: this.isOpen(now),
      closesAt:
        this.hasKeys() && now < this.closesAt
          ? new Date(this.closesAt).toISOString()
          : null,
      waiting: [...this.waiting.values()].map(
        ({ gateId, keyChanged, since, lastAttemptAt, address }) => ({
          gateId,
          keyChanged,
          since,
          lastAttemptAt,
          address,
        }),
      ),
    };
  }

  open(now = Date.now()): GatePairingState {
    this.closesAt = now + PAIRING_WINDOW_MS;
    this.rejected.clear();
    return this.changed();
  }

  accept(gateId: string): GatePairingState {
    this.saveKey(gateId, this.waitingOrFail(gateId).key);
    this.waiting.delete(gateId);
    this.logger.log(`Gate ${gateId} approved`);
    return this.changed();
  }

  reject(gateId: string): GatePairingState {
    this.waitingOrFail(gateId);
    this.waiting.delete(gateId);
    this.rejected.add(gateId);
    return this.changed();
  }

  private isOpen(now: number): boolean {
    return this.autoAccept || !this.hasKeys() || now < this.closesAt;
  }

  private hasKeys(): boolean {
    return Object.keys(this.keys).length > 0;
  }

  private validToken(
    key: string,
    gateId: string,
    password: string,
    now: number,
  ): boolean {
    const [expiryText, mac] = password.split('.');
    const expiry = Number(expiryText);
    if (
      !Number.isSafeInteger(expiry) ||
      !HEX_KEY.test(mac ?? '') ||
      expiry < now - CLOCK_SLACK_MS ||
      expiry > now + TOKEN_LIFETIME_MS + CLOCK_SLACK_MS ||
      expiry <= (this.lastExpiry.get(gateId) ?? 0)
    ) {
      return false;
    }
    const expected = createHmac('sha256', Buffer.from(key, 'hex'))
      .update(`${gateId}.${expiry}`)
      .digest();
    return timingSafeEqual(expected, Buffer.from(mac, 'hex'));
  }

  private waitingOrFail(gateId: string) {
    const entry = this.waiting.get(gateId);
    if (!entry) {
      throw new NotFoundException(
        apiError(
          ApiErrorCode.GATE_NOT_WAITING,
          `Gate ${gateId} is not waiting for approval`,
        ),
      );
    }
    return entry;
  }

  private refuse(gateId: string, reason: string, now: number): GateLogin {
    const last = this.lastRefusalLog.get(gateId) ?? -Infinity;
    if (now - last >= REFUSAL_LOG_INTERVAL_MS) {
      this.lastRefusalLog.set(gateId, now);
      this.logger.warn(
        `Refused gate ${gateId}: ${reason}. Open "Pair gates" on the Hardware page to pair it.`,
      );
    }
    return GateLogin.REFUSED;
  }

  private saveKey(gateId: string, key: string): void {
    this.keys = { ...this.keys, [gateId]: key };
    this.lastExpiry.delete(gateId);
    writeFileSync(
      this.path(),
      `${JSON.stringify({ keys: this.keys }, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  private changed(): GatePairingState {
    const state = this.state();
    this.emitter.emit('gate.pairing-changed', state);
    return state;
  }

  private path(): string {
    return join(configDir(), 'gate-keys.json');
  }
}
