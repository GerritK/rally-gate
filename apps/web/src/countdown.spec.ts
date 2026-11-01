import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countdownState,
  isQueued,
  jumpStartMs,
  toneTimes,
} from './countdown.ts';

const SLOT = Date.parse('2026-11-01T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

test('lights stay dark until 5 s before the slot', () => {
  assert.deepEqual(countdownState(SLOT, SLOT - 8_000), {
    lit: 0,
    green: false,
    secondsLeft: 8,
  });
});

test('all five lights come on 5 s out and go out one per second', () => {
  assert.equal(countdownState(SLOT, SLOT - 5_000).lit, 5);
  assert.equal(countdownState(SLOT, SLOT - 4_999).lit, 5);
  assert.equal(countdownState(SLOT, SLOT - 4_000).lit, 4);
  assert.equal(countdownState(SLOT, SLOT - 1).lit, 1);
});

test('green exactly on the slot', () => {
  assert.deepEqual(countdownState(SLOT, SLOT), {
    lit: 0,
    green: true,
    secondsLeft: 0,
  });
});

test('tones: 10 s out, each light, a long one on green', () => {
  const tones = toneTimes(SLOT, SLOT - 20_000);
  assert.deepEqual(
    tones.map((tone) => (SLOT - tone.atMs) / 1000),
    [10, 5, 4, 3, 2, 1, 0],
  );
  assert.deepEqual(
    tones.map((tone) => tone.long),
    [false, false, false, false, false, false, true],
  );
});

test('tones already past are not played late', () => {
  assert.equal(toneTimes(SLOT, SLOT - 3_500).length, 4);
});

test('a slot run is queued until green has been shown', () => {
  const run = {
    status: 'STARTED',
    startTime: iso(SLOT),
    plannedStartTime: iso(SLOT),
  };
  assert.equal(isQueued(run, SLOT - 1_000), true);
  assert.equal(isQueued(run, SLOT + 4_999), true);
  assert.equal(isQueued(run, SLOT + 5_000), false);
  assert.equal(isQueued({ ...run, plannedStartTime: null }, SLOT - 1), false);
  assert.equal(isQueued({ ...run, status: 'FINISHED' }, SLOT - 1), false);
});

test('a jump start is earlier than slot minus the tolerance', () => {
  const run = (offsetMs: number) => ({
    plannedStartTime: iso(SLOT),
    startPassingAt: iso(SLOT + offsetMs),
  });
  assert.equal(jumpStartMs(run(-200), 200), null);
  assert.equal(jumpStartMs(run(-201), 200), 201);
  assert.equal(jumpStartMs(run(3_000), 200), null);
  assert.equal(
    jumpStartMs({ plannedStartTime: iso(SLOT), startPassingAt: null }, 200),
    null,
  );
});
