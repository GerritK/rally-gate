import {
  GateRole,
  HEARTBEAT_ONLINE_THRESHOLD_MS,
  RallyStatus,
  StageRunStatus,
  StageScoring,
  StageStatus,
  EntryStatus,
} from '@rally-gate/shared';
import {
  currentLocale,
  formatStageDuration,
  parseStageDuration,
  t,
} from '@rally-gate/ui';
import type { GateAssignment } from './api/gate-assignments';
import type { Gate } from './api/gates';
import type { Entry } from './api/entries';
import { driverName } from './crew';

/**
 * Where a clock offset stops looking like ordinary network transit and
 * starts looking like a real problem worth showing amber. Purely a display
 * threshold — the server has its own, higher one for deciding when to
 * actually correct, which this page reads from settings rather than
 * duplicating.
 */
export const CLOCK_OFFSET_WARN_THRESHOLD_MS = 250;

/**
 * A gate's NTP accuracy (`ntpOffsetMs`) past which it shows amber. Measured
 * ESP32 and Pi gates sit around 0.5–2ms on rally Wi-Fi.
 */
export const NTP_OFFSET_WARN_THRESHOLD_MS = 5;

function formatClockAmount(absMs: number): string {
  return absMs < 1000 ? `${absMs} ms` : `${(absMs / 1000).toFixed(2)} s`;
}

export function formatClockOffset(offsetMs?: number | null): string {
  if (offsetMs === null || offsetMs === undefined) return t('gate.notMeasured');
  return `${offsetMs < 0 ? '-' : '+'}${formatClockAmount(Math.abs(offsetMs))}`;
}

/** "3 ms nach" / "2 ms vor", as one says of a watch; positive = gate behind. */
export function formatClockLag(offsetMs?: number | null): string {
  if (offsetMs === null || offsetMs === undefined) return t('gate.notMeasured');
  const amount = formatClockAmount(Math.abs(offsetMs));
  if (offsetMs === 0) return amount;
  return t(offsetMs > 0 ? 'gate.clockBehindBy' : 'gate.clockAheadBy', {
    amount,
  });
}

/** A clock turning back for a gate behind, forward for one ahead. */
export function clockLagIcon(
  offsetMs: number | null | undefined,
  correctionThresholdMs: number,
): string {
  if (offsetMs === null || offsetMs === undefined) return 'mdi-clock-outline';
  if (Math.abs(offsetMs) >= correctionThresholdMs) {
    return 'mdi-clock-alert-outline';
  }
  if (offsetMs === 0) return 'mdi-clock-check-outline';
  return offsetMs > 0 ? 'mdi-history' : 'mdi-update';
}

export function ntpOffsetColor(gate: {
  ntpSynced?: boolean | null;
  ntpOffsetMs?: number | null;
}): string {
  if (!gate.ntpSynced) return 'error';
  return (gate.ntpOffsetMs ?? 0) >= NTP_OFFSET_WARN_THRESHOLD_MS
    ? 'warning'
    : 'success';
}

export function clockOffsetColor(
  offsetMs: number | null | undefined,
  correctionThresholdMs: number,
): string {
  if (offsetMs === null || offsetMs === undefined) return 'timing-idle';
  const abs = Math.abs(offsetMs);
  if (abs >= correctionThresholdMs) return 'error';
  return abs >= CLOCK_OFFSET_WARN_THRESHOLD_MS ? 'warning' : 'success';
}

/** Explains what the server is doing about this gate's offset, if anything. */
export function clockOffsetHint(
  offsetMs: number | null | undefined,
  correctionThresholdMs: number,
): string {
  if (offsetMs === null || offsetMs === undefined) {
    return t('gate.clockNotReported');
  }
  const lag = formatClockLag(offsetMs);
  return Math.abs(offsetMs) >= correctionThresholdMs
    ? t('gate.clockCorrected', { lag })
    : t('gate.clockWithinTolerance', { lag });
}

export function formatDuration(ms?: number | null): string {
  return ms == null ? '-' : formatStageDuration(ms);
}

export function formatGap(ms: number): string {
  return ms === 0 ? '-' : `+${formatStageDuration(ms)}`;
}

export function runStatusColor(status: StageRunStatus): string {
  switch (status) {
    case StageRunStatus.FINISHED:
      return 'success';
    case StageRunStatus.STARTED:
      return 'info';
    case StageRunStatus.CANCELLED:
      return 'error';
    case StageRunStatus.VOIDED:
      // Neutral, not red: a voided run isn't a failure by the crew, it's a
      // struck-out attempt. Red is for penalties, DNF and abort.
      return 'timing-idle';
  }
}

/** Closed ✓, running ●, not started ○: the shapes differ, so colour is
 *  never the only signal. Labels are getters, so each read is in the current
 *  language. */
export const STAGE_STATUS_DISPLAY: Record<
  StageStatus,
  { label: string; color: string; icon: string }
> = {
  [StageStatus.NOT_STARTED]: {
    get label() {
      return t('stageStatus.notStarted');
    },
    color: 'timing-idle',
    icon: 'mdi-circle-outline',
  },
  [StageStatus.ACTIVE]: {
    get label() {
      return t('stageStatus.active');
    },
    color: 'success',
    icon: 'mdi-circle',
  },
  [StageStatus.CLOSED]: {
    get label() {
      return t('stageStatus.closed');
    },
    color: 'timing-idle',
    icon: 'mdi-check-circle-outline',
  },
};

/** The app bar chip and Setup → Rally. Closed is not red: official results
 *  are no race problem. */
export const RALLY_STATUS_DISPLAY: Record<
  RallyStatus,
  { label: string; color: string; icon: string }
> = {
  [RallyStatus.SETUP]: {
    get label() {
      return t('rallyStatus.setup');
    },
    color: 'timing-idle',
    icon: 'mdi-wrench-outline',
  },
  [RallyStatus.RUNNING]: {
    get label() {
      return t('rallyStatus.running');
    },
    color: 'success',
    icon: 'mdi-flag-variant-outline',
  },
  [RallyStatus.CLOSED]: {
    get label() {
      return t('rallyStatus.closed');
    },
    color: 'secondary',
    icon: 'mdi-flag-checkered',
  },
};

/** Only a stage outside the overall carries this as a mark beside its name. */
export function stageScoringLabel(scoring: StageScoring): string {
  switch (scoring) {
    case StageScoring.OVERALL:
      return t('stageScoring.overall');
    case StageScoring.QUALIFYING:
      return t('stageScoring.qualifying');
    case StageScoring.NONE:
      return t('stageScoring.none');
  }
}

/** Withdrawn and disqualified are race problems (red); the rest is entry
 *  paperwork. Labels are getters, so each read is in the current language. */
export const ENTRY_STATUS_DISPLAY: Record<
  EntryStatus,
  { label: string; color: string; icon: string }
> = {
  [EntryStatus.REGISTERED]: {
    get label() {
      return t('entryStatus.registered');
    },
    color: 'timing-idle',
    icon: 'mdi-clipboard-text-outline',
  },
  [EntryStatus.CHECKED_IN]: {
    get label() {
      return t('entryStatus.checkedIn');
    },
    color: 'info',
    icon: 'mdi-clipboard-check-outline',
  },
  [EntryStatus.SCRUTINEERED]: {
    get label() {
      return t('entryStatus.scrutineered');
    },
    color: 'success',
    icon: 'mdi-check-decagram',
  },
  [EntryStatus.WITHDRAWN]: {
    get label() {
      return t('entryStatus.withdrawn');
    },
    color: 'error',
    icon: 'mdi-flag-remove',
  },
  [EntryStatus.DISQUALIFIED]: {
    get label() {
      return t('entryStatus.disqualified');
    },
    color: 'error',
    icon: 'mdi-cancel',
  },
};

/** DNF and DSQ end a car's stage (red); DNS only means it never came. */
export function outcomeColor(outcome: string): string {
  return outcome === 'DNS' ? 'warning' : 'error';
}

/** "Fri 09.10. 14:05": when a list was published or a sheet printed, with
 *  the day, since a start list is often posted the evening before. */
export function formatStamp(time: string | number): string {
  return new Date(time).toLocaleString(currentLocale(), {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    // 24h in every language: "en" alone reads as en-US, which says AM/PM.
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A correction only ever nudges the time of day (the marshal fixing a
 * missed/bad detection knows the exact second, not a different date) — the
 * date always comes from context (the run's existing date, or today for a
 * new run), never from the picker itself.
 */
export function combineDateAndTime(
  dateSource: string | Date,
  timeValue: string,
): string {
  const d = new Date(dateSource);
  const [h, m, s] = timeValue.split(':').map(Number);
  d.setHours(h, m, s ?? 0, 0);
  return d.toISOString();
}

export function entryName(entries: Entry[], entryId: string): string {
  const entry = entries.find((v) => v.id === entryId);
  return entry ? `#${entry.startNumber} ${driverName(entry)}` : entryId;
}

export function isOnline(
  gate: Gate,
  nowMs: number,
  thresholdMs = HEARTBEAT_ONLINE_THRESHOLD_MS,
): boolean {
  if (!gate.lastHeartbeatAt) return false;
  return nowMs - new Date(gate.lastHeartbeatAt).getTime() < thresholdMs;
}

/** Fit to time: online, and NTP not known to be unsynced. A gate that
 * can't report it (unknown) still counts — the offset column covers it. */
export function isReady(gate: Gate, nowMs: number): boolean {
  return isOnline(gate, nowMs) && gate.ntpSynced !== false;
}

export function gateStatusIcon(gate: Gate, nowMs: number): string {
  if (!isOnline(gate, nowMs)) return 'mdi-access-point-off';
  return isReady(gate, nowMs) ? 'mdi-access-point' : 'mdi-clock-alert-outline';
}

export function gateStatusColor(gate: Gate, nowMs: number): string {
  if (!isOnline(gate, nowMs)) return 'error';
  return isReady(gate, nowMs) ? 'success' : 'warning';
}

/** An event file without its extension, as a marshal named it. */
export function eventName(file: string): string {
  return file.replace(/\.sqlite$/, '');
}

/** `1:30` or `90` as whole seconds, as penalties are given; null otherwise. */
export function parseWholeSeconds(text: string): number | null {
  const ms = parseStageDuration(text);
  return ms !== null && ms % 1000 === 0 ? ms / 1000 : null;
}

/** Whole seconds as `01:30`, the way `parseWholeSeconds` reads them back. */
export function formatWholeSeconds(seconds: number): string {
  return formatStageDuration(seconds * 1000).replace(/.0$/, '');
}

/** Vuetify field rule for a `parseWholeSeconds` field. */
export const wholeSeconds = (value: string | null) =>
  parseWholeSeconds(value ?? '') !== null || t('common.wholeSeconds');

/** Vuetify field rule for a field the form can't save without. */
export const required = (value: unknown) =>
  (value !== '' && value != null) || t('common.required');

export function gateRoleLabel(
  assignment: Pick<GateAssignment, 'role' | 'splitIndex'>,
): string {
  switch (assignment.role) {
    case GateRole.STAGE_START:
      return t('gateRole.start');
    case GateRole.STAGE_FINISH:
      return t('gateRole.finish');
    case GateRole.STAGE_START_FINISH:
      return t('gateRole.startFinish');
    case GateRole.STAGE_SPLIT:
      return t('gateRole.split', { n: assignment.splitIndex ?? '' });
  }
}

/** Icons that qualify a time in a table. Cells and `TableLegend` both read
 *  them from here, so the legend can't drift from what the table shows. */
export const TIMING_MARKS = {
  best: {
    icon: 'mdi-star',
    color: 'timing-best',
    get label() {
      return t('marks.best');
    },
  },
  manual: {
    icon: 'mdi-hand-back-right-outline',
    color: 'warning',
    get label() {
      return t('marks.manual');
    },
  },
  notional: {
    icon: 'mdi-timer-off-outline',
    color: undefined,
    get label() {
      return t('marks.notional');
    },
  },
} as const;

export type TimingMark = keyof typeof TIMING_MARKS;
