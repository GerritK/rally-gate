import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finishAfter, startBefore } from './midnight.ts';

const at = (day: number, h: number, m: number, s = 0) =>
  new Date(2026, 9, day, h, m, s).toISOString();

test('a finish after midnight moves to the next day', () => {
  assert.equal(finishAfter(at(31, 23, 58), at(31, 0, 3, 10)), at(32, 0, 3, 10));
});

test('a finish already after the start stays', () => {
  assert.equal(finishAfter(at(31, 10, 0), at(31, 10, 5)), at(31, 10, 5));
});

test('a finish typed before the start stays, for the server to refuse', () => {
  assert.equal(finishAfter(at(31, 10, 5), at(31, 10, 0)), at(31, 10, 0));
});

test('a finish equal to the start stays', () => {
  assert.equal(finishAfter(at(31, 10, 0), at(31, 10, 0)), at(31, 10, 0));
});

test('a finish moved back before midnight moves to the day of the start', () => {
  assert.equal(finishAfter(at(31, 23, 50), at(32, 23, 55)), at(31, 23, 55));
});

test('a start before midnight moves to the previous day', () => {
  assert.equal(startBefore(at(32, 0, 5), at(32, 23, 58)), at(31, 23, 58));
});

test('a start already before the finish stays', () => {
  assert.equal(startBefore(at(31, 10, 5), at(31, 10, 0)), at(31, 10, 0));
});

test('a start typed after the finish stays, for the server to refuse', () => {
  assert.equal(startBefore(at(31, 10, 0), at(31, 10, 5)), at(31, 10, 5));
});

test('a start equal to the finish stays', () => {
  assert.equal(startBefore(at(31, 10, 0), at(31, 10, 0)), at(31, 10, 0));
});

test('a start moved past midnight moves to the day of the finish', () => {
  assert.equal(startBefore(at(32, 0, 10), at(31, 0, 1)), at(32, 0, 1));
});
