import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EntryStatus,
  GateRole,
  StageScoring,
  StageStatus,
} from '@rally-gate/shared';
import { preStartCheck, type CheckEntry } from './pre-start-check.ts';

const car = (
  startNumber: number,
  identifier: string | null,
  status = EntryStatus.SCRUTINEERED,
): CheckEntry => ({
  startNumber,
  status,
  transponders: identifier ? [{ kind: 'RC', identifier }] : [],
  classes: [{}],
});

const ready = {
  stages: [
    {
      id: 'WP1',
      status: StageStatus.NOT_STARTED,
      scoring: StageScoring.OVERALL,
    },
  ],
  assignments: [
    { gateId: 'G1', stageId: 'WP1', role: GateRole.STAGE_START },
    { gateId: 'G2', stageId: 'WP1', role: GateRole.STAGE_FINISH },
  ],
  gates: [
    { id: 'G1', name: 'Start', online: true, ready: true },
    { id: 'G2', name: 'Finish', online: true, ready: true },
  ],
  entries: [car(1, '111'), car(2, '222')],
  anyClass: true,
};

test('a rally ready to go finds nothing', () => {
  assert.deepEqual(preStartCheck(ready), []);
});

test('no counted stage and no car are errors, listed first', () => {
  const findings = preStartCheck({
    ...ready,
    stages: [{ ...ready.stages[0], scoring: StageScoring.NONE }],
    entries: [car(1, '111', EntryStatus.WITHDRAWN)],
  });
  assert.deepEqual(
    findings.map((f) => [f.error, f.key]),
    [
      [true, 'noEntries'],
      [true, 'noCountedStage'],
    ],
  );
});

test('a missing finish, an offline gate and an unsynced one only warn', () => {
  const findings = preStartCheck({
    ...ready,
    assignments: [ready.assignments[0]],
    gates: [
      { id: 'G1', name: 'Start', online: true, ready: false },
      { id: 'G3', name: 'Spare', online: false, ready: false },
    ],
  });
  assert.deepEqual(
    findings.map((f) => [f.error, f.key, f.params]),
    [
      [false, 'noFinishGate', { stages: 'WP1' }],
      [false, 'gatesUnsynced', { gates: 'Start' }],
    ],
  );
});

test('names cars without a transponder and cars sharing one', () => {
  const findings = preStartCheck({
    ...ready,
    entries: [car(3, '333'), car(1, '333'), car(2, null)],
  });
  assert.deepEqual(
    findings.map((f) => f.params),
    [{ numbers: '#2' }, { transponder: '333', numbers: '#1, #3' }],
  );
});

test('a car without a class only matters once classes exist', () => {
  const classless = { ...car(1, '111'), classes: [] };
  assert.deepEqual(
    preStartCheck({ ...ready, entries: [classless] }).map((f) => f.key),
    ['noClass'],
  );
  assert.deepEqual(
    preStartCheck({ ...ready, entries: [classless], anyClass: false }),
    [],
  );
});
