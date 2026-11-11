import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EntryStatus,
  StageRunStatus,
  StageStatus,
  type Starter,
  type StartOrder,
} from '@rally-gate/shared';
import { buildRows, countStates, isOverdue, type RowRun } from './live-rows.ts';

const NOW = Date.parse('2026-05-01T10:00:00Z');
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const starter = (n: number, mainClassName: string | null = null): Starter =>
  ({
    position: n,
    entryId: `e${n}`,
    startNumber: n,
    mainClassName,
    slotTime: null,
    slotMoved: false,
  }) as Starter;

const order = (starters: Starter[], grouped = false): StartOrder =>
  ({ stageId: 'WP1', frozen: true, grouped, starters }) as StartOrder;

const run = (n: number, over: Partial<RowRun> = {}): RowRun => ({
  id: `r${n}`,
  entryId: `e${n}`,
  attempt: 1,
  voided: false,
  status: StageRunStatus.FINISHED,
  durationMs: 60_000,
  startTime: at(-120_000),
  plannedStartTime: null,
  ...over,
});

const rows = (
  starters: Starter[],
  runs: RowRun[],
  over: Partial<Parameters<typeof buildRows>[0]> = {},
) =>
  buildRows({
    order: order(starters),
    runs,
    entryById: new Map(
      starters.map((s) => [s.entryId, { status: EntryStatus.SCRUTINEERED }]),
    ),
    dnsIds: [],
    stageStatus: StageStatus.ACTIVE,
    now: NOW,
    countdownMs: 30_000,
    noMainClass: 'No main class',
    ...over,
  });
const states = (r: { state: string }[]) => r.map((row) => row.state);

test('no start order, no rows', () => {
  assert.deepEqual(rows([], [], { order: null }), []);
});

test('Next is the first waiting car, even before one that started early', () => {
  const s = [1, 2, 3].map((n) => starter(n));
  const result = rows(s, [run(1), run(3, { status: StageRunStatus.STARTED })]);
  assert.deepEqual(states(result), ['FINISHED', 'NEXT', 'ON_STAGE']);
});

test('nobody is Next before the stage is active or after it closed', () => {
  const s = [starter(1), starter(2)];
  for (const stageStatus of [StageStatus.NOT_STARTED, StageStatus.CLOSED]) {
    assert.deepEqual(states(rows(s, [], { stageStatus })), [
      'WAITING',
      'WAITING',
    ]);
  }
});

test('a run decides the state before the entry or a DNS does', () => {
  const s = [1, 2, 3, 4, 5].map((n) => starter(n));
  const result = rows(
    s,
    [run(1, { status: StageRunStatus.DNF, durationMs: null })],
    {
      dnsIds: ['e2', 'e3'],
      entryById: new Map([
        ['e1', { status: EntryStatus.WITHDRAWN }],
        ['e2', { status: EntryStatus.SCRUTINEERED }],
        ['e3', { status: EntryStatus.DISQUALIFIED }],
        ['e4', { status: EntryStatus.WITHDRAWN }],
        ['e5', { status: EntryStatus.REGISTERED }],
      ]),
    },
  );
  // A withdrawn car that drove keeps its DNF; out of the event beats DNS;
  // a car not yet scrutineered still waits, and is Next.
  assert.deepEqual(states(result), ['DNF', 'DNS', 'OUT', 'OUT', 'NEXT']);
});

test('a voided attempt asks for a re-run until the stage is closed', () => {
  const s = [starter(1), starter(2)];
  const voided = run(1, { voided: true });
  const active = rows(s, [voided]);
  assert.deepEqual(states(active), ['RERUN', 'NEXT']);
  assert.equal(active[0].run, undefined);
  assert.deepEqual(active[0].voidedRuns, [voided]);
  assert.equal(active[0].runCount, 0);
  assert.deepEqual(
    states(rows(s, [voided], { stageStatus: StageStatus.CLOSED })),
    ['WAITING', 'WAITING'],
  );
});

test('voided attempts are listed in the order they were driven', () => {
  const result = rows(
    [starter(1)],
    [
      run(1, { id: 'third', attempt: 3 }),
      run(1, { id: 'second', attempt: 2, voided: true }),
      run(1, { id: 'first', attempt: 1, voided: true }),
    ],
  );
  assert.deepEqual(
    result[0].voidedRuns.map((r) => r.id),
    ['first', 'second'],
  );
  assert.equal(result[0].run?.id, 'third');
});

test('a slot counts down only inside the countdown, before that it waits', () => {
  const slot = (n: number, inMs: number) =>
    run(n, {
      status: StageRunStatus.STARTED,
      durationMs: null,
      startTime: at(inMs),
      plannedStartTime: at(inMs),
    });
  const s = [1, 2, 3].map((n) => starter(n));
  const result = rows(s, [slot(1, 20_000), slot(2, 300_000)]);
  // The third car has no slot yet: it is the one still to be sent.
  assert.deepEqual(states(result), ['QUEUED', 'SLOTTED', 'NEXT']);
});

test('a grouped list heads each main-class block once', () => {
  const s = [
    starter(1, 'Pro'),
    starter(2, 'Pro'),
    starter(3, null),
    starter(4, 'Junior'),
  ];
  const grouped = rows(s, [], { order: order(s, true) });
  assert.deepEqual(
    grouped.map((row) => row.classHeader),
    ['Pro', null, 'No main class', 'Junior'],
  );
  assert.deepEqual(
    rows(s, []).map((row) => row.classHeader),
    [null, null, null, null],
  );
});

test('counts fold Next and a waiting slot into Waiting, in a fixed order', () => {
  const counted = countStates(
    ['FINISHED', 'NEXT', 'WAITING', 'SLOTTED', 'ON_STAGE', 'FINISHED'].map(
      (state) => ({ state }) as { state: 'NEXT' },
    ),
  );
  assert.deepEqual(counted, [
    { state: 'ON_STAGE', count: 1 },
    { state: 'WAITING', count: 3 },
    { state: 'FINISHED', count: 2 },
  ]);
});

test('overdue only while on stage, past the expected time, when one is set', () => {
  const onStage = { status: StageRunStatus.STARTED, startTime: at(-90_000) };
  assert.equal(isOverdue({ expectedDurationMs: 60_000 }, onStage, NOW), true);
  assert.equal(isOverdue({ expectedDurationMs: 120_000 }, onStage, NOW), false);
  assert.equal(isOverdue({ expectedDurationMs: null }, onStage, NOW), false);
  assert.equal(isOverdue(undefined, onStage, NOW), false);
  assert.equal(
    isOverdue(
      { expectedDurationMs: 60_000 },
      { ...onStage, status: StageRunStatus.FINISHED },
      NOW,
    ),
    false,
  );
});
