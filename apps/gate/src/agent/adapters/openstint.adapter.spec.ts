import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePassing, toWallClockMs } from './openstint.adapter';

test('parses a passing, including fields appended by newer versions', () => {
  assert.deepEqual(
    parsePassing('P 1791234567890 OPN 1615544 -3.50 64 89113 24.3 extra'),
    {
      timestampMs: 1791234567890,
      transponderId: '1615544',
      rssi: -3.5,
      hits: 64,
      mer: 24.3,
    },
  );
  assert.equal(
    parsePassing('P 1658197240 AMB 3616557 3.88 21')?.mer,
    undefined,
  );
});

test('ignores status lines, startup output and malformed passings', () => {
  assert.equal(parsePassing('S 1792039754 -41.01 5.08 0 0 3.01'), null);
  assert.equal(parsePassing('Listening on tcp://*:5556'), null);
  assert.equal(parsePassing('P 123 OPN'), null);
  assert.equal(parsePassing('P abc OPN 1 2 3'), null);
});

test('keeps the decoder timestamp, not the later receipt', () => {
  assert.equal(toWallClockMs(1_000_000, 1_000_300), 1_000_000);
});

test('falls back to receipt time for a monotonic or stepped timestamp', () => {
  assert.equal(toWallClockMs(12_345, 1_791_234_567_890), 1_791_234_567_890);
  assert.equal(toWallClockMs(1_000_500, 1_000_000), 1_000_000);
});
