import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTracking } from './time-sync';

test('reads a synced tracking line', () => {
  const sync = parseTracking(
    'C0A8010A,192.168.1.10,3,1759140000.123456789,-0.000412345,-0.000100000,0.000300000,-12.345,0.010,0.050,0.002000000,0.000500000,64.2,Normal\n',
  );
  assert.equal(sync?.chronySynced, true);
  assert.ok(Math.abs(sync!.chronyOffsetMs - 0.412345) < 1e-9);
});

test('reads an unsynced tracking line', () => {
  const sync = parseTracking(
    '00000000,,0,0.000000000,0.000000000,0.000000000,0.000000000,0.000,0.000,0.000,1.000000000,1.000000000,0.0,Not synchronised',
  );
  assert.equal(sync?.chronySynced, false);
});

test('rejects anything that is not a tracking line', () => {
  assert.equal(parseTracking('506 Cannot talk to daemon'), undefined);
});
