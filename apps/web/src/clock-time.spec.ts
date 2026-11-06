import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClockTime } from './clock-time.ts';

test('accepts the lenient forms', () => {
  assert.equal(parseClockTime('14:03:27'), '14:03:27');
  assert.equal(parseClockTime(' 14.03.27 '), '14:03:27');
  assert.equal(parseClockTime('9:5:3'), '09:05:03');
  assert.equal(parseClockTime('14:03'), '14:03:00');
  assert.equal(parseClockTime('140327'), '14:03:27');
  assert.equal(parseClockTime('90327'), '09:03:27');
  assert.equal(parseClockTime('1403'), '14:03:00');
  assert.equal(parseClockTime('14'), '14:00:00');
  assert.equal(parseClockTime('00:00:00'), '00:00:00');
  assert.equal(parseClockTime(''), '');
});

test('rejects what is not a 24 h time', () => {
  for (const text of [
    '24:00:00',
    '14:60:00',
    '14:03:60',
    '14:7:',
    '1234567',
    '14:03:27:01',
    '2pm',
    '14:03:27.5',
  ])
    assert.equal(parseClockTime(text), null, text);
});
