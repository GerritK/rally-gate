import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassingMatcher } from './beam-openstint.adapter';

const W = 500;
const LATER = 1_000_000;

function run(beams: number[], reads: [string, number][]) {
  const m = new PassingMatcher(W);
  beams.forEach((t) => m.addBeam(t));
  reads.forEach(([id, t]) => m.addRead(id, t));
  return m
    .flush(LATER)
    .map((e) => [e.transponderId, e.timestampMs, e.metadata]);
}

test('one beam and one read: the beam time with the transponder', () => {
  assert.deepEqual(run([1000], [['7', 1040]]), [
    ['7', 1000, { readOffsetMs: 40 }],
  ]);
});

test('a beam without a read goes to the marshal', () => {
  assert.deepEqual(run([1000], []), [[undefined, 1000, {}]]);
});

test('a read without a beam times on its own', () => {
  assert.deepEqual(run([], [['7', 1000]]), [['7', 1000, { beam: 'missed' }]]);
});

test('two cars in one beam edge: each read times on its own, the beam has both as candidates', () => {
  assert.deepEqual(
    run(
      [1000],
      [
        ['7', 1000],
        ['8', 1200],
      ],
    ),
    [
      [undefined, 1000, { candidates: ['7', '8'] }],
      ['7', 1000, { beam: 'ambiguous' }],
      ['8', 1200, { beam: 'ambiguous' }],
    ],
  );
});

test('two beams around one read: never guesses which', () => {
  assert.deepEqual(run([1000, 1300], [['7', 1150]]), [
    [undefined, 1000, { candidates: ['7'] }],
    ['7', 1150, { beam: 'ambiguous' }],
    [undefined, 1300, { candidates: ['7'] }],
  ]);
});

test('cars spaced past the window pair independently', () => {
  assert.deepEqual(
    run(
      [1000, 3000],
      [
        ['7', 1010],
        ['8', 2990],
      ],
    ),
    [
      ['7', 1000, { readOffsetMs: 10 }],
      ['8', 3000, { readOffsetMs: -10 }],
    ],
  );
});

test('waits until a later read could no longer change the pairing', () => {
  const m = new PassingMatcher(W);
  m.addBeam(1000);
  m.addRead('7', 1000);
  assert.deepEqual(m.flush(1000 + 2 * W), []);
  m.addRead('8', 1400);
  assert.deepEqual(
    m.flush(LATER).map((e) => e.transponderId),
    [undefined, '7', '8'],
  );
});

test('emits each passing once across flushes', () => {
  const m = new PassingMatcher(W);
  m.addBeam(1000);
  m.addRead('7', 1000);
  assert.equal(m.flush(LATER).length, 1);
  assert.equal(m.flush(LATER + 1).length, 0);
});

test('pairs whichever arrives first', () => {
  const m = new PassingMatcher(W);
  m.addRead('7', 980);
  m.addBeam(1000);
  assert.deepEqual(
    m.flush(LATER).map((e) => [e.transponderId, e.timestampMs]),
    [['7', 1000]],
  );
});
