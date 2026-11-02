import type { AccessRole } from './auth';

/**
 * A change a person made to a result (`docs/auth.md`): what a protest, or
 * undoing a correction on the wrong car, needs to look up.
 */
export enum ChangeAction {
  /** Start now, or a run typed in by hand. */
  RUN_CREATED = 'RUN_CREATED',
  RUN_FINISHED = 'RUN_FINISHED',
  RUN_CORRECTED = 'RUN_CORRECTED',
  RUN_VOIDED = 'RUN_VOIDED',
  RUN_RESTORED = 'RUN_RESTORED',
  RUN_DELETED = 'RUN_DELETED',
  /** DNF on the stage, and its undo. */
  DNF_MARKED = 'DNF_MARKED',
  DNF_UNDONE = 'DNF_UNDONE',
  /** DNS on the stage, and its undo: no run, so no snapshot. */
  DNS_MARKED = 'DNS_MARKED',
  DNS_UNDONE = 'DNS_UNDONE',
  /** A slot set by the Countdown button (`SLOT_MANUAL`). */
  COUNTDOWN_STARTED = 'COUNTDOWN_STARTED',
  COUNTDOWN_CANCELLED = 'COUNTDOWN_CANCELLED',
  /** New slot on a timetable: `before` is null for a car that had none. */
  SLOT_MOVED = 'SLOT_MOVED',
  /** Delay on a timetable: no entry, `after` holds the delay. */
  SLOTS_DELAYED = 'SLOTS_DELAYED',
  JUMP_START_DISMISSED = 'JUMP_START_DISMISSED',
  PENALTY_ADDED = 'PENALTY_ADDED',
  PENALTY_DELETED = 'PENALTY_DELETED',
  PASSING_ASSIGNED = 'PASSING_ASSIGNED',
  /** No entry: kept for a rally-wide view, shown on no entry's page. */
  PASSING_DISMISSED = 'PASSING_DISMISSED',
  ENTRY_STATUS = 'ENTRY_STATUS',
}

/** A run as it stood: times as ISO strings. */
export interface RunSnapshot {
  attempt: number;
  startTime: string;
  finishTime: string | null;
}

export interface PenaltySnapshot {
  typeId: string | null;
  count: number;
  seconds: number | null;
  note: string | null;
}

export interface PassingSnapshot {
  gateId: string;
  /** Effective time: gate time plus the correction applied. */
  time: string;
}

export interface EntryStatusSnapshot {
  status: string;
}

export interface DelaySnapshot {
  delayMs: number;
}

export type ChangeSnapshot =
  | RunSnapshot
  | PenaltySnapshot
  | PassingSnapshot
  | EntryStatusSnapshot
  | DelaySnapshot;

/** `GET /api/entries/:id/changes`, newest first. */
export interface ChangeView {
  id: string;
  at: string;
  action: ChangeAction;
  stageId: string | null;
  before: ChangeSnapshot | null;
  after: ChangeSnapshot | null;
  /** Null: the server machine itself. */
  by: {
    deviceId: string;
    role: AccessRole;
    /** The invitation's, null for an organiser password login. */
    label: string | null;
    number: number;
  } | null;
}
