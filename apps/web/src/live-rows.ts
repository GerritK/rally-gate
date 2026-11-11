import {
  isOutOfEvent,
  StageRunStatus,
  StageStatus,
  type Starter,
} from '@rally-gate/shared';
import { t } from '@rally-gate/ui';
import type { Entry } from './api/entries';
import type { StageRun, StageSplit } from './api/stage-runs';
import type { StartOrder } from './api/start-order';
import { countingRun } from './counting-run';
import { isCountingDown, isQueued } from './countdown';
import { runStatusColor } from './format';

/** Live Timing's rows: what its header, On stage card and table all draw. */

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

export interface Row {
  starter: Starter;
  /** The attempt that counts — on a shakedown the open run, else the fastest. */
  run?: StageRun;
  /** Non-voided runs; more than one only on a shakedown. */
  runCount: number;
  voidedRuns: StageRun[];
  state: RowState;
  /** Set on the first row of a main-class block. */
  classHeader: string | null;
}

/** Labels are getters, so each read is in the current language. */
export const ROW_STATE_DISPLAY: Record<
  RowState,
  { label: string; color: string; icon: string }
> = {
  WAITING: {
    get label() {
      return t('rowState.waiting');
    },
    color: 'timing-idle',
    icon: 'mdi-clock-outline',
  },
  NEXT: {
    get label() {
      return t('rowState.next');
    },
    color: 'info',
    icon: 'mdi-arrow-right-bold',
  },
  QUEUED: {
    get label() {
      return t('rowState.queued');
    },
    color: 'info',
    icon: 'mdi-timer-sand',
  },
  SLOTTED: {
    get label() {
      return t('rowState.waiting');
    },
    color: 'timing-idle',
    icon: 'mdi-clock-outline',
  },
  ON_STAGE: {
    get label() {
      return t('runState.onStage');
    },
    color: runStatusColor(StageRunStatus.STARTED),
    icon: 'mdi-car-sports',
  },
  FINISHED: {
    get label() {
      return t('rowState.finished');
    },
    color: runStatusColor(StageRunStatus.FINISHED),
    icon: 'mdi-flag-checkered',
  },
  DNF: {
    get label() {
      return t('rowState.dnf');
    },
    color: runStatusColor(StageRunStatus.DNF),
    icon: 'mdi-close',
  },
  DNS: {
    get label() {
      return t('rowState.dns');
    },
    color: 'warning',
    icon: 'mdi-minus-circle-outline',
  },
  RERUN: {
    get label() {
      return t('rowState.rerun');
    },
    color: runStatusColor(StageRunStatus.VOIDED),
    icon: 'mdi-cancel',
  },
  OUT: {
    get label() {
      return t('entryStatus.withdrawn');
    },
    color: 'timing-idle',
    icon: 'mdi-account-off',
  },
};

/** Every entry in start order with the attempt that counts and its state. */
export function buildRows({
  order,
  runs: stageRuns,
  entryById,
  dnsIds,
  stageStatus,
  now,
  countdownMs,
}: {
  order: StartOrder | null;
  runs: StageRun[];
  entryById: Map<string, Entry>;
  dnsIds: string[];
  stageStatus?: StageStatus;
  now: number;
  countdownMs: number;
}): Row[] {
  if (!order) return [];
  const closed = stageStatus === StageStatus.CLOSED;
  const runsByEntry = new Map<string, StageRun[]>();
  for (const run of stageRuns) {
    runsByEntry.set(run.entryId, [
      ...(runsByEntry.get(run.entryId) ?? []),
      run,
    ]);
  }

  const base = order.starters.map((starter): Omit<Row, 'classHeader'> => {
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
        ? (row.starter.mainClassName ?? t('live.noMainClass'))
        : null,
  }));
}

/** Non-zero states only, NEXT and SLOTTED counted as waiting. */
export function countStates(rows: Row[]) {
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

/** A car in the On stage card, see `LiveView`'s `onStage`. */
export interface OnStageCar {
  row: Row;
  run: StageRun;
  /** Split indices it has passed. */
  passed: Set<number>;
  last?: StageSplit;
  /** Behind the fastest at its last split. */
  gapMs?: number;
}

export function isOverdue(
  stage: { expectedDurationMs?: number | null } | undefined,
  run: StageRun | undefined,
  now: number,
): boolean {
  const expected = stage?.expectedDurationMs;
  return (
    run?.status === StageRunStatus.STARTED &&
    !!expected &&
    now - new Date(run.startTime).getTime() > expected
  );
}
