import { StageRunStatus } from '@rally-gate/shared';
import { t } from '@rally-gate/ui';
import type { StageRun, StageSplit } from './api/stage-runs';
import { runStatusColor } from './format';
import type { RowOf, RowState } from './live-rows';

/** A row of Live timing as the app holds it, see `live-rows.ts`. */
export type Row = RowOf<StageRun>;

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
