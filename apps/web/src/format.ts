import {
  GATE_CONFIG_PORT,
  GateRole,
  HEARTBEAT_ONLINE_THRESHOLD_MS,
  StageRunStatus,
  StageStatus,
  EntryStatus,
} from '@rally-gate/shared';
import { formatStageDuration } from '@rally-gate/ui';
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

export function formatClockOffset(offsetMs?: number | null): string {
  if (offsetMs === null || offsetMs === undefined) return 'not measured';
  const sign = offsetMs < 0 ? '-' : '+';
  const abs = Math.abs(offsetMs);
  return abs < 1000
    ? `${sign}${abs} ms`
    : `${sign}${(abs / 1000).toFixed(2)} s`;
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
    return 'This gate has not reported its clock yet.';
  }
  const behind = offsetMs > 0 ? 'behind' : 'ahead of';
  if (Math.abs(offsetMs) >= correctionThresholdMs) {
    return `Clock is ${formatClockOffset(offsetMs)} ${behind} the server — detections from this gate are being corrected. Check its time sync.`;
  }
  return `Clock is within tolerance (${formatClockOffset(offsetMs)}); no correction applied.`;
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
 *  never the only signal. */
export const STAGE_STATUS_DISPLAY: Record<
  StageStatus,
  { label: string; color: string; icon: string }
> = {
  [StageStatus.NOT_STARTED]: {
    label: 'Not started',
    color: 'timing-idle',
    icon: 'mdi-circle-outline',
  },
  [StageStatus.ACTIVE]: {
    label: 'Running',
    color: 'success',
    icon: 'mdi-circle',
  },
  [StageStatus.CLOSED]: {
    label: 'Closed',
    color: 'timing-idle',
    icon: 'mdi-check-circle-outline',
  },
};

/** Withdrawn and disqualified are race problems (red); the rest is entry
 *  paperwork. */
export const ENTRY_STATUS_DISPLAY: Record<
  EntryStatus,
  { label: string; color: string; icon: string }
> = {
  [EntryStatus.REGISTERED]: {
    label: 'Registered',
    color: 'timing-idle',
    icon: 'mdi-clipboard-text-outline',
  },
  [EntryStatus.CHECKED_IN]: {
    label: 'Checked in',
    color: 'info',
    icon: 'mdi-clipboard-check-outline',
  },
  [EntryStatus.SCRUTINEERED]: {
    label: 'Scrutineered',
    color: 'success',
    icon: 'mdi-check-decagram',
  },
  [EntryStatus.WITHDRAWN]: {
    label: 'Withdrawn',
    color: 'error',
    icon: 'mdi-flag-remove',
  },
  [EntryStatus.DISQUALIFIED]: {
    label: 'Disqualified',
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
  return new Date(time).toLocaleString([], {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
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

/** Fit to time: online, and chrony not known to be unsynced. A gate that
 * can't report chrony (unknown) still counts — the offset column covers it. */
export function isReady(gate: Gate, nowMs: number): boolean {
  return isOnline(gate, nowMs) && gate.chronySynced !== false;
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

/** Vuetify field rule for a field the form can't save without. */
export const required = (value: unknown) =>
  (value !== '' && value != null) || 'Required';

export function gateConfigUrl(address: string): string {
  return `http://${address.includes(':') ? `[${address}]` : address}:${GATE_CONFIG_PORT}/`;
}

export function gateRoleLabel(
  assignment: Pick<GateAssignment, 'role' | 'splitIndex'>,
): string {
  switch (assignment.role) {
    case GateRole.STAGE_START:
      return 'Start';
    case GateRole.STAGE_FINISH:
      return 'Finish';
    case GateRole.STAGE_START_FINISH:
      return 'Start/Finish';
    case GateRole.STAGE_SPLIT:
      return `Split ${assignment.splitIndex ?? ''}`;
  }
}

/** Icons that qualify a time in a table. Cells and `TableLegend` both read
 *  them from here, so the legend can't drift from what the table shows. */
export const TIMING_MARKS = {
  best: { icon: 'mdi-star', color: 'timing-best', label: 'Fastest' },
  manual: {
    icon: 'mdi-hand-back-right-outline',
    color: 'warning',
    label: 'Set by a marshal, not a gate',
  },
  notional: {
    icon: 'mdi-timer-off-outline',
    color: undefined,
    label:
      'Notional: stage not completed, charged the slowest time plus a penalty',
  },
} as const;

export type TimingMark = keyof typeof TIMING_MARKS;
