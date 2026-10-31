import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StageRunStatus } from '@rally-gate/shared';
import { countingRun } from './counting-run.ts';

const finished = (id: string, durationMs: number) => ({
  id,
  voided: false,
  status: StageRunStatus.FINISHED,
  durationMs,
});

test('shows the car on stage before any finished run', () => {
  const open = {
    id: 'open',
    voided: false,
    status: StageRunStatus.STARTED,
    durationMs: null,
  };
  assert.equal(countingRun([finished('a', 90_000), open])?.id, 'open');
});

test('otherwise the fastest finished run, never a voided one', () => {
  const voidedFaster = { ...finished('v', 50_000), voided: true };
  assert.equal(
    countingRun([finished('a', 90_000), voidedFaster, finished('b', 80_000)])
      ?.id,
    'b',
  );
});

test('a DNF stays when it is all there is', () => {
  const dnf = {
    id: 'dnf',
    voided: false,
    status: StageRunStatus.CANCELLED,
    durationMs: null,
  };
  assert.equal(countingRun([dnf])?.id, 'dnf');
});
