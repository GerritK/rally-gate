import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateLogin, GatePairingService } from './gate-pairing.service';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const NOW = 1_800_000_000_000;

function token(key: string, gateId: string, expiry: number): string {
  const mac = createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`${gateId}.${expiry}`)
    .digest('hex');
  return `${expiry}.${mac}`;
}

describe('GatePairingService', () => {
  const env = process.env;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gate-keys-'));
    process.env = { ...env, CONFIG_DIR: dir };
  });
  afterAll(() => (process.env = env));

  function make() {
    const service = new GatePairingService({ emit: jest.fn() } as never);
    service.onModuleInit();
    return service;
  }

  /** Paired through the real flow: asked for the key, sent it, accepted. */
  function paired(): GatePairingService {
    const service = make();
    expect(service.login('G1', token(KEY, 'G1', NOW + 60_000), null, NOW)).toBe(
      GateLogin.SEND_KEY,
    );
    expect(service.login('G1', `key:${KEY}`, '10.0.0.5', NOW)).toBe(
      GateLogin.REFUSED,
    );
    expect(service.state(NOW).waiting).toMatchObject([
      { gateId: 'G1', keyChanged: false, address: '10.0.0.5' },
    ]);
    service.accept('G1');
    return service;
  }

  it('pairs the first gate while none is known, and stores its key', () => {
    paired();
    expect(
      JSON.parse(readFileSync(join(dir, 'gate-keys.json'), 'utf8')),
    ).toEqual({ keys: { G1: KEY } });
  });

  it('accepts a valid token once, and only within its lifetime', () => {
    const service = paired();
    const valid = token(KEY, 'G1', NOW + 60_000);
    expect(service.login('G1', valid, null, NOW)).toBe(GateLogin.ACCEPTED);
    expect(service.login('G1', valid, null, NOW)).toBe(GateLogin.REFUSED);
    expect(service.login('G1', token(KEY, 'G1', NOW - 11_000), null, NOW)).toBe(
      GateLogin.REFUSED,
    );
    expect(service.login('G1', token(KEY, 'G1', NOW + 71_000), null, NOW)).toBe(
      GateLogin.REFUSED,
    );
    expect(service.login('G2', token(KEY, 'G1', NOW + 61_000), null, NOW)).toBe(
      GateLogin.REFUSED,
    );
  });

  it('accepts the token gate-agent and the ESP32 build for the shared test vector', () => {
    expect(
      paired().login(
        'G1',
        '1800000060000.4231b15975d7e3739ed595c7308c5cb7aee07c44536aa735be18c701e45de59a',
        null,
        NOW,
      ),
    ).toBe(GateLogin.ACCEPTED);
  });

  it('keeps the keys across a restart', () => {
    paired();
    expect(make().login('G1', token(KEY, 'G1', NOW + 60_000), null, NOW)).toBe(
      GateLogin.ACCEPTED,
    );
  });

  it('refuses unknown gates without asking for the key while pairing is closed', () => {
    const service = paired();
    expect(
      service.login('G2', token(OTHER_KEY, 'G2', NOW + 60_000), null, NOW),
    ).toBe(GateLogin.REFUSED);
    expect(service.login('G2', `key:${OTHER_KEY}`, null, NOW)).toBe(
      GateLogin.REFUSED,
    );
    expect(service.state(NOW).waiting).toEqual([]);
  });

  it('shows a changed key as waiting and keeps the old key valid until accepted', () => {
    const service = paired();
    service.open(NOW);
    expect(
      service.login('G1', token(OTHER_KEY, 'G1', NOW + 60_000), null, NOW),
    ).toBe(GateLogin.SEND_KEY);
    service.login('G1', `key:${OTHER_KEY}`, null, NOW);
    expect(service.state(NOW).waiting).toMatchObject([
      { gateId: 'G1', keyChanged: true },
    ]);
    expect(service.login('G1', token(KEY, 'G1', NOW + 61_000), null, NOW)).toBe(
      GateLogin.ACCEPTED,
    );
  });

  it('keeps a rejected gate out for the rest of the window', () => {
    const service = paired();
    service.open(NOW);
    service.login('G2', `key:${OTHER_KEY}`, null, NOW);
    service.reject('G2');
    expect(
      service.login('G2', token(OTHER_KEY, 'G2', NOW + 60_000), null, NOW),
    ).toBe(GateLogin.REFUSED);
    service.open(NOW);
    expect(
      service.login('G2', token(OTHER_KEY, 'G2', NOW + 61_000), null, NOW),
    ).toBe(GateLogin.SEND_KEY);
  });

  it('closes pairing after ten minutes', () => {
    const service = paired();
    service.open(NOW);
    expect(service.state(NOW + 599_000).open).toBe(true);
    expect(
      service.login(
        'G2',
        token(OTHER_KEY, 'G2', NOW + 660_000),
        null,
        NOW + 600_000,
      ),
    ).toBe(GateLogin.REFUSED);
  });

  it('holds at most 20 waiting gates', () => {
    const service = make();
    for (let i = 0; i < 20; i++) {
      service.login(`G${i}`, `key:${KEY}`, null, NOW);
    }
    expect(service.login('G20', 'x', null, NOW)).toBe(GateLogin.REFUSED);
    expect(service.state(NOW).waiting).toHaveLength(20);
  });
});
