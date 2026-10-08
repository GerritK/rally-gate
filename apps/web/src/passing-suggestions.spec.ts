import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GateRole } from '@rally-gate/shared';
import {
  suggestEntries,
  type CarOnStage,
  type Passing,
  type PlannedGate,
} from './passing-suggestions.ts';

const T0 = Date.parse('2026-10-09T10:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

const gate = (
  gateId: string,
  role: GateRole,
  extra: Partial<PlannedGate> = {},
): PlannedGate => ({ gateId, stageId: 'WP1', role, active: true, ...extra });

const beam = (eventId: string, gateId: string, s: number): Passing => ({
  eventId,
  gateId,
  timestampGate: at(s),
  transponderId: null,
  transponderKind: null,
});

const car = (entryId: string, startS: number): CarOnStage => ({
  entryId,
  runId: `run-${entryId}`,
  startTime: at(startS),
});

const suggest = (input: Partial<Parameters<typeof suggestEntries>[0]>) =>
  suggestEntries({
    passings: [],
    gates: [],
    stageId: 'WP1',
    dueToStart: [],
    onStage: [],
    splitsByRun: {},
    entries: [],
    minDurationMs: 10_000,
    ...input,
  });

test('start passings take the start list in order, each car once', () => {
  assert.deepEqual(
    suggest({
      gates: [gate('S', GateRole.STAGE_START)],
      // Out of arrival order on purpose: matched by gate time.
      passings: [beam('p2', 'S', 60), beam('p1', 'S', 0)],
      dueToStart: ['a', 'b', 'c'],
    }),
    { p1: 'a', p2: 'b' },
  );
});

test('finish passings take the cars on stage in expected arrival order', () => {
  assert.deepEqual(
    suggest({
      gates: [gate('F', GateRole.STAGE_FINISH)],
      passings: [beam('p1', 'F', 300)],
      onStage: [car('b', 60), car('a', 0)],
    }),
    { p1: 'b' },
  );
});

test('a split skips a car that already passed that split', () => {
  assert.deepEqual(
    suggest({
      gates: [gate('X', GateRole.STAGE_SPLIT, { splitIndex: 1 })],
      passings: [beam('p1', 'X', 120)],
      onStage: [car('a', 0), car('b', 60)],
      splitsByRun: { 'run-a': [{ splitIndex: 1 }] },
    }),
    { p1: 'b' },
  );
});

test('a shared transponder narrows the suggestion to the cars carrying it', () => {
  const shared: Passing = {
    ...beam('p1', 'F', 300),
    transponderId: '42',
    transponderKind: 'RC',
  };
  assert.deepEqual(
    suggest({
      gates: [gate('F', GateRole.STAGE_FINISH)],
      passings: [shared],
      onStage: [car('a', 0), car('b', 60)],
      entries: [
        { id: 'b', transponders: [{ kind: 'RC', identifier: '42' }] },
        { id: 'c', transponders: [{ kind: 'RC', identifier: '42' }] },
      ],
    }),
    { p1: 'b' },
  );
});

test('passings at an inactive gate or another stage get no suggestion', () => {
  assert.deepEqual(
    suggest({
      gates: [
        gate('S', GateRole.STAGE_START, { active: false }),
        gate('O', GateRole.STAGE_START, { stageId: 'WP2' }),
      ],
      passings: [beam('p1', 'S', 0), beam('p2', 'O', 0)],
      dueToStart: ['a'],
    }),
    {},
  );
});

test('combined gate: past the minimum time it is the longest-out car finishing', () => {
  assert.deepEqual(
    suggest({
      gates: [gate('SF', GateRole.STAGE_START_FINISH)],
      passings: [beam('p1', 'SF', 200)],
      onStage: [car('b', 100), car('a', 0)],
      dueToStart: ['c'],
    }),
    { p1: 'a' },
  );
});

test('combined gate: within the minimum time of a start it suggests nobody', () => {
  assert.deepEqual(
    suggest({
      gates: [gate('SF', GateRole.STAGE_START_FINISH)],
      passings: [beam('p1', 'SF', 5)],
      onStage: [car('a', 0)],
      dueToStart: ['b'],
    }),
    {},
  );
});

test('combined gate: with nobody on stage it is the next start', () => {
  assert.deepEqual(
    suggest({
      gates: [gate('SF', GateRole.STAGE_START_FINISH)],
      passings: [beam('p1', 'SF', 0)],
      dueToStart: ['b', 'c'],
    }),
    { p1: 'b' },
  );
});
