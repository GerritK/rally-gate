import { EntryStatus, TransponderKind } from '@rally-gate/shared';
import { notify, t, useConfirm } from '@rally-gate/ui';
import {
  updateEntry,
  type Entry,
  type EntryPatch,
  type TransponderInput,
} from './api/entries';

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
        return {
          to,
          label: t('entryAction.checkIn'),
          icon: 'mdi-clipboard-check-outline',
        };
      if (from === SCRUTINEERED)
        return {
          to,
          label: t('entryAction.undoScrutineering'),
          icon: 'mdi-decagram-outline',
        };
      return null;
    case SCRUTINEERED:
      if (from === CHECKED_IN)
        return {
          to,
          label: t('entryAction.passScrutineering'),
          short: t('entryAction.passShort'),
          icon: 'mdi-check-decagram',
        };
      // A small event without a technical check does both at the desk.
      if (from === REGISTERED)
        return {
          to,
          label: t('entryAction.checkInAndPass'),
          icon: 'mdi-check-decagram',
        };
      return null;
    case REGISTERED:
      if (out)
        return { to, label: t('entryAction.reinstate'), icon: 'mdi-restore' };
      if (from !== REGISTERED)
        return {
          to,
          label: t('entryAction.undoCheckIn'),
          icon: 'mdi-clipboard-remove-outline',
        };
      return null;
    case WITHDRAWN:
      return from === WITHDRAWN
        ? null
        : { to, label: t('entryAction.withdraw'), icon: 'mdi-flag-remove' };
    case DISQUALIFIED:
      return from === DISQUALIFIED
        ? null
        : { to, label: t('entryAction.disqualify'), icon: 'mdi-cancel' };
  }
}

/** The next step as the one direct action, every other change for the
 *  menu, in the order the statuses run, then out of the event. */
export function statusActions(status: EntryStatus): {
  next: StatusAction | null;
  others: StatusAction[];
} {
  const next = NEXT[status] ? action(status, NEXT[status]) : null;
  const others = [REGISTERED, CHECKED_IN, SCRUTINEERED, WITHDRAWN, DISQUALIFIED]
    .filter((to) => to !== NEXT[status])
    .map((to) => action(status, to))
    .filter((a): a is StatusAction => a !== null);
  return { next, others };
}

const DONE: Record<EntryStatus, string> = {
  [REGISTERED]: 'entryAction.done.registered',
  [CHECKED_IN]: 'entryAction.done.checkedIn',
  [SCRUTINEERED]: 'entryAction.done.scrutineered',
  [WITHDRAWN]: 'entryAction.done.withdrawn',
  [DISQUALIFIED]: 'entryAction.done.disqualified',
};

/** Getters, so each read is in the current language. */
export const TRANSPONDER_KINDS: Record<TransponderKind, string> = {
  get [TransponderKind.RC]() {
    return t('transponder.rc');
  },
  get [TransponderKind.NFC]() {
    return t('transponder.nfc');
  },
};

/** "1234567", "NFC 0042 (driver tag)" — RC goes without saying. */
export function transponderLabels(entry: Entry): string[] {
  return entry.transponders.map(
    (t) =>
      `${t.kind === TransponderKind.RC ? '' : `${t.kind} `}${t.identifier}` +
      (t.label ? ` (${t.label})` : ''),
  );
}

export interface TransponderDraft {
  kind: TransponderKind;
  identifier: string;
  label: string;
}

/** At least one row, so the common case — one RC transponder — is typed
 *  straight in rather than added first. */
export function toTransponderDrafts(entry: Entry | null): TransponderDraft[] {
  const drafts = (entry?.transponders ?? []).map((t) => ({
    kind: t.kind,
    identifier: t.identifier,
    label: t.label ?? '',
  }));
  return drafts.length > 0
    ? drafts
    : [{ kind: TransponderKind.RC, identifier: '', label: '' }];
}

/** A row left empty is no transponder. */
export function toTransponderInput(
  drafts: TransponderDraft[],
): TransponderInput[] {
  return drafts
    .filter((d) => d.identifier.trim())
    .map((d) => ({
      kind: d.kind,
      identifier: d.identifier.trim(),
      label: d.label.trim() || null,
    }));
}

/** Allowed, all of it — refusing would block the desk mid-swap — but worth
 *  saying. Per row: the transponder is also on another car, so its passings
 *  wait on Live Timing for a marshal to say which car it was. For the list:
 *  several of one kind, which a car physically carries one of. */
export function transponderWarnings(
  entries: Entry[],
  drafts: TransponderDraft[],
  selfId?: string,
): { rows: (string | undefined)[]; list?: string } {
  const rows = drafts.map(({ kind, identifier }) => {
    const id = identifier.trim();
    const others = id
      ? entries.filter(
          (v) =>
            v.id !== selfId &&
            v.transponders.some((t) => t.kind === kind && t.identifier === id),
        )
      : [];
    if (others.length === 0) return undefined;
    const on = others.map((v) => `#${v.startNumber}`).join(', ');
    return t('transponder.alsoOn', { on });
  });
  const kinds = toTransponderInput(drafts).map((t) => t.kind);
  const doubled = Object.values(TransponderKind).find(
    (kind) => kinds.filter((k) => k === kind).length > 1,
  );
  return {
    rows,
    list: doubled
      ? t('transponder.several', {
          kinds: t(`transponder.${doubled.toLowerCase()}Plural`),
        })
      : undefined,
  };
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
        title: t('entryAction.disqualifyTitle', { nr: entry.startNumber }),
        text: t('entryAction.disqualifyText'),
        confirmText: t('entryAction.disqualify'),
        color: 'error',
      }))
    )
      return null;
    const saved = await updateEntry(entry.id, { ...extra, status: to });
    notify(t(DONE[to], { nr: entry.startNumber }));
    return saved;
  };
}
