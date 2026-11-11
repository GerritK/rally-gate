import {
  isOutOfEvent,
  StageRunStatus,
  StageStatus,
  type EntryStatus,
  type Starter,
  type StartOrder,
} from '@rally-gate/shared';
import { countingRun } from './counting-run.ts';
import { isCountingDown, isQueued } from './countdown.ts';

/**
 * Live timing's rows: what its header, On stage card and table all draw.
 * Free of Vue and the API (structural types), so `node --test` covers it:
 * which car is Next decides who a marshal sends off.
 */

export type RowState =
  | 'WAITING'
  | 'NEXT'
  | 'QUEUED'
  /** A timetable slot not yet counting down: shown as waiting. */
  | 'SLOTTED'
  | 'ON_STAGE'
  | 'FINISHED'
  | 'DNF'
  | 'DNS'
  | 'RERUN'
  | 'OUT';

/** What a row needs of a stage run. */
export interface RowRun {
  id: string;
  entryId: string;
  attempt: number;
  voided: boolean;
  status: StageRunStatus;
  durationMs?: number | null;
  startTime: string;
  plannedStartTime: string | null;
}

export interface RowOf<R extends RowRun> {
  starter: Starter;
  /** The attempt that counts — on a shakedown the open run, else the fastest. */
  run?: R;
  /** Non-voided runs; more than one only on a shakedown. */
  runCount: number;
  voidedRuns: R[];
  state: RowState;
  /** Set on the first row of a main-class block. */
  classHeader: string | null;
}

/** Every entry in start order with the attempt that counts and its state. */
export function buildRows<R extends RowRun>({
  order,
  runs: stageRuns,
  entryById,
  dnsIds,
  stageStatus,
  now,
  countdownMs,
  noMainClass,
}: {
  order: StartOrder | null;
  runs: R[];
  entryById: Map<string, { status: EntryStatus }>;
  dnsIds: string[];
  stageStatus?: StageStatus;
  now: number;
  countdownMs: number;
  /** The header of the block of cars without a main class. */
  noMainClass: string;
}): RowOf<R>[] {
  if (!order) return [];
  const closed = stageStatus === StageStatus.CLOSED;
  const runsByEntry = new Map<string, R[]>();
  for (const run of stageRuns) {
    runsByEntry.set(run.entryId, [
      ...(runsByEntry.get(run.entryId) ?? []),
      run,
    ]);
  }

  const base = order.starters.map((starter): Omit<RowOf<R>, 'classHeader'> => {
    const runs = runsByEntry.get(starter.entryId) ?? [];
    const run = countingRun(runs);
    const voidedRuns = runs
      .filter((r) => r.voided)
      .sort((a, b) => a.attempt - b.attempt);
    const entry = entryById.get(starter.entryId);
    let state: RowState;
    if (isQueued(run, now)) {
      state = isCountingDown(
        new Date(run!.startTime).getTime(),
        now,
        countdownMs,
      )
        ? 'QUEUED'
        : 'SLOTTED';
    } else if (run?.status === StageRunStatus.STARTED) state = 'ON_STAGE';
    else if (run?.status === StageRunStatus.FINISHED) state = 'FINISHED';
    else if (run?.status === StageRunStatus.DNF) state = 'DNF';
    else if (entry && isOutOfEvent(entry.status)) state = 'OUT';
    else if (dnsIds.includes(starter.entryId)) state = 'DNS';
    else if (voidedRuns.length > 0 && !closed) state = 'RERUN';
    else state = 'WAITING';
    return {
      starter,
      run,
      runCount: runs.filter((r) => !r.voided).length,
      voidedRuns,
      state,
    };
  });

  // Next = the first waiting car, even before one that started: an early start
  // doesn't move anyone else's slot, and a no-show stays Next so the gap shows.
  if (stageStatus === StageStatus.ACTIVE) {
    const next = base.findIndex((row) => row.state === 'WAITING');
    if (next !== -1) base[next].state = 'NEXT';
  }

  return base.map((row, i) => ({
    ...row,
    classHeader:
      order.grouped &&
      (i === 0 ||
        base[i - 1].starter.mainClassName !== row.starter.mainClassName)
        ? (row.starter.mainClassName ?? noMainClass)
        : null,
  }));
}

/** Non-zero states only, NEXT and SLOTTED counted as waiting. */
export function countStates(rows: { state: RowState }[]) {
  const counts = new Map<RowState, number>();
  for (const row of rows) {
    const state =
      row.state === 'NEXT' || row.state === 'SLOTTED' ? 'WAITING' : row.state;
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const order: RowState[] = [
    'QUEUED',
    'ON_STAGE',
    'WAITING',
    'FINISHED',
    'DNF',
    'DNS',
    'RERUN',
    'OUT',
  ];
  return order
    .filter((state) => counts.has(state))
    .map((state) => ({ state, count: counts.get(state)! }));
}

export function isOverdue(
  stage: { expectedDurationMs?: number | null } | undefined,
  run: Pick<RowRun, 'status' | 'startTime'> | undefined,
  now: number,
): boolean {
  const expected = stage?.expectedDurationMs;
  return (
    run?.status === StageRunStatus.STARTED &&
    !!expected &&
    now - new Date(run.startTime).getTime() > expected
  );
}
