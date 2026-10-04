import { EntryStatus } from '@rally-gate/shared';
import { notify, useConfirm } from '@rally-gate/ui';
import { updateEntry, type Entry, type EntryPatch } from './api/entries';

const { REGISTERED, CHECKED_IN, SCRUTINEERED, WITHDRAWN, DISQUALIFIED } =
  EntryStatus;

export interface StatusAction {
  to: EntryStatus;
  label: string;
  /** For a table row, where the full label would push the column off a
   *  tablet's screen; the full one is its tooltip. */
  short?: string;
  icon: string;
}

/** The desk's way forward: registered, checked in, passed by the
 *  scrutineers. Nothing after that; out of the event is a choice, not a
 *  step. */
const NEXT: Partial<Record<EntryStatus, EntryStatus>> = {
  [REGISTERED]: CHECKED_IN,
  [CHECKED_IN]: SCRUTINEERED,
};

function action(from: EntryStatus, to: EntryStatus): StatusAction | null {
  const out = from === WITHDRAWN || from === DISQUALIFIED;
  switch (to) {
    case CHECKED_IN:
      if (from === REGISTERED)
        return { to, label: 'Check in', icon: 'mdi-clipboard-check-outline' };
      if (from === SCRUTINEERED)
        return { to, label: 'Back to checked in', icon: 'mdi-undo' };
      return null;
    case SCRUTINEERED:
      if (from === CHECKED_IN)
        return {
          to,
          label: 'Passed scrutineering',
          short: 'Passed',
          icon: 'mdi-check-decagram',
        };
      // A small event without a technical check does both at the desk.
      if (from === REGISTERED)
        return { to, label: 'Check in and pass', icon: 'mdi-check-decagram' };
      return null;
    case REGISTERED:
      if (out) return { to, label: 'Reinstate', icon: 'mdi-restore' };
      if (from !== REGISTERED)
        return { to, label: 'Back to registered', icon: 'mdi-undo' };
      return null;
    case WITHDRAWN:
      return from === WITHDRAWN
        ? null
        : { to, label: 'Withdraw', icon: 'mdi-flag-remove' };
    case DISQUALIFIED:
      return from === DISQUALIFIED
        ? null
        : { to, label: 'Disqualify', icon: 'mdi-cancel' };
  }
}

/** The next step as the one direct action, every other change for the
 *  menu: forward first, then back, then out of the event. */
export function statusActions(status: EntryStatus): {
  next: StatusAction | null;
  others: StatusAction[];
} {
  const next = NEXT[status] ? action(status, NEXT[status]) : null;
  const others = [SCRUTINEERED, CHECKED_IN, REGISTERED, WITHDRAWN, DISQUALIFIED]
    .filter((to) => to !== NEXT[status])
    .map((to) => action(status, to))
    .filter((a): a is StatusAction => a !== null);
  return { next, others };
}

const DONE: Record<EntryStatus, string> = {
  [REGISTERED]: 'registered',
  [CHECKED_IN]: 'checked in',
  [SCRUTINEERED]: 'passed scrutineering',
  [WITHDRAWN]: 'withdrawn',
  [DISQUALIFIED]: 'disqualified',
};

/** A transponder already on another car. Allowed (a shared or swapped
 *  transponder is a marshal's call) but worth saying: a passing is timed for
 *  only one of the cars carrying it. */
export function transponderWarning(
  entries: Entry[],
  transponderId: string | null | undefined,
  selfId?: string,
): string | undefined {
  const id = transponderId?.trim();
  const others = id
    ? entries.filter((v) => v.id !== selfId && v.transponderId === id)
    : [];
  if (others.length === 0) return undefined;
  const on = others.map((v) => `#${v.startNumber}`).join(', ');
  return `Also on ${on}: a passing is timed for only one of them.`;
}

/** Steps that move a car on at a station, as opposed to setting it back or
 *  taking it out of the event. */
export const isForward = (to: EntryStatus) =>
  to === CHECKED_IN || to === SCRUTINEERED;

/** Applies a status change, with `extra` fields saved in the same request
 *  (the desk's transponder with Check in). Only disqualifying asks: the car
 *  leaves every result and the cars behind move up, which nothing on screen
 *  shows. Every other change is one click to undo. */
export function useEntryStatus() {
  const confirm = useConfirm();
  return async function setStatus(
    entry: Entry,
    to: EntryStatus,
    extra: EntryPatch = {},
  ): Promise<Entry | null> {
    if (
      to === DISQUALIFIED &&
      !(await confirm({
        title: `Disqualify #${entry.startNumber}?`,
        text: 'It leaves every result and the cars behind it move up. Its times stay stored; Reinstate brings it back.',
        confirmText: 'Disqualify',
        color: 'error',
      }))
    )
      return null;
    const saved = await updateEntry(entry.id, { ...extra, status: to });
    notify(`#${entry.startNumber} ${DONE[to]}`);
    return saved;
  };
}
