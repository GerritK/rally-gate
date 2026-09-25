import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptTrigger, parseTimestampNs, toWallClockMs } from './beam.adapter';

test('parses both gpiomon timestamp formats', () => {
  assert.equal(parseTimestampNs('12 5000'), 12_000_005_000n); // v1: %s %n
  assert.equal(parseTimestampNs('12.000005000'), 12_000_005_000n); // v2: %S
  assert.equal(parseTimestampNs('RISING EDGE'), null);
});

test('one car is one trigger, the next car is another', () => {
  const ms = 1_000_000n;
  assert.equal(acceptTrigger(0n, undefined, 500), true);
  assert.equal(acceptTrigger(40n * ms, 0n, 500), false); // rear of the same car
  assert.equal(acceptTrigger(500n * ms, 0n, 500), true);
});

test('backdates the detection to the edge, not the receipt', () => {
  const eventNs = 10_000_000_000n;
  const nowNs = eventNs + 3_000_000n; // read 3ms after the edge
  assert.equal(toWallClockMs(eventNs, nowNs, 1_000_000), 999_997);
});

test('falls back to receipt time when the clocks disagree', () => {
  assert.equal(toWallClockMs(10n ** 12n, 0n, 1_000_000), 1_000_000);
});
