import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLOCK_BAD_AFTER_MS,
  GateState,
  LOST_AFTER_MS,
  StatusSignals,
} from './status-signals';

const up: GateState = { connected: true, decoderRunning: true, clock: 'ok' };

test('ready once connected, decoder running and clock synced', () => {
  const s = new StatusSignals();
  assert.equal(s.next(0, { ...up, connected: false }), undefined);
  assert.equal(s.next(1000, { ...up, clock: 'pending' }), undefined);
  assert.equal(s.next(2000, up), 'ready');
  assert.equal(s.next(3000, up), undefined);
});

test('a hiccup under 15s is silent, both ways', () => {
  const s = new StatusSignals();
  s.next(0, up);
  assert.equal(s.next(1000, { ...up, connected: false }), undefined);
  assert.equal(
    s.next(1000 + LOST_AFTER_MS - 1, { ...up, connected: false }),
    undefined,
  );
  assert.equal(s.next(1000 + LOST_AFTER_MS, up), undefined);
});

test('lost after 15s once, then ready again on return', () => {
  const s = new StatusSignals();
  s.next(0, up);
  const down = { ...up, connected: false };
  s.next(1000, down);
  assert.equal(s.next(1000 + LOST_AFTER_MS, down), 'connectionLost');
  assert.equal(s.next(1000 + LOST_AFTER_MS + 5000, down), undefined);
  assert.equal(s.next(60_000, up), 'ready');
});

test('a server never reached says nothing', () => {
  const s = new StatusSignals();
  const down = { ...up, connected: false };
  for (let t = 0; t <= 5 * 60_000; t += 1000) {
    assert.equal(s.next(t, down), undefined);
  }
});

test('an unsynced clock withholds ready, then warns once after 60s', () => {
  const s = new StatusSignals();
  const bad = { ...up, clock: 'bad' as const };
  assert.equal(s.next(0, bad), undefined);
  assert.equal(s.next(CLOCK_BAD_AFTER_MS - 1, bad), undefined);
  assert.equal(s.next(CLOCK_BAD_AFTER_MS, bad), 'clockUnsynced');
  assert.equal(s.next(CLOCK_BAD_AFTER_MS + 1000, bad), undefined);
  assert.equal(s.next(CLOCK_BAD_AFTER_MS + 2000, up), 'ready');
});

test('a clock that syncs inside 60s needs no warning', () => {
  const s = new StatusSignals();
  assert.equal(s.next(0, { ...up, clock: 'bad' }), undefined);
  assert.equal(s.next(10_000, up), 'ready');
  assert.equal(s.next(100_000, up), undefined);
});

test('a clock lost later warns after 60s and announces its return', () => {
  const s = new StatusSignals();
  s.next(0, up);
  const bad = { ...up, clock: 'bad' as const };
  assert.equal(s.next(10_000, bad), undefined);
  assert.equal(s.next(10_000 + CLOCK_BAD_AFTER_MS, bad), 'clockUnsynced');
  assert.equal(s.next(200_000, up), 'ready');
});
