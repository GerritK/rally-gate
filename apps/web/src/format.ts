import {
  GATE_CONFIG_PORT,
  GateRole,
  HEARTBEAT_ONLINE_THRESHOLD_MS,
  StageStatus,
  VehicleStatus,
} from '@rally-gate/shared';
import { formatStageDuration } from '@rally-gate/ui';
import type { GateAssignment } from './api/gate-assignments';
import type { Gate } from './api/gates';
import type { Stage } from './api/stages';
import type { Vehicle } from './api/vehicles';

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

export function runStatusColor(status: string): string {
  switch (status) {
    case 'FINISHED':
      return 'success';
    case 'STARTED':
      return 'info';
    case 'CANCELLED':
      return 'error';
    case 'VOIDED':
      // Neutral, not red: a voided run isn't a failure by the crew, it's a
      // struck-out attempt. Red stays reserved for penalties/DNF/abort per
      // the theme conventions in packages/ui.
      return 'timing-idle';
    default:
      return 'timing-idle';
  }
}

/** The same shapes as `StagePicker`: closed ✓, running ●, upcoming ○. */
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
    icon: 'mdi-check',
  },
};

/** Withdrawn and disqualified are race problems (red); the rest is entry
 *  paperwork. */
export const VEHICLE_STATUS_DISPLAY: Record<
  VehicleStatus,
  { label: string; color: string; icon: string }
> = {
  [VehicleStatus.REGISTERED]: {
    label: 'Registered',
    color: 'timing-idle',
    icon: 'mdi-clipboard-text-outline',
  },
  [VehicleStatus.CHECKED_IN]: {
    label: 'Checked in',
    color: 'info',
    icon: 'mdi-clipboard-check-outline',
  },
  [VehicleStatus.SCRUTINEERED]: {
    label: 'Scrutineered',
    color: 'success',
    icon: 'mdi-check-decagram',
  },
  [VehicleStatus.WITHDRAWN]: {
    label: 'Withdrawn',
    color: 'error',
    icon: 'mdi-flag-remove',
  },
  [VehicleStatus.DISQUALIFIED]: {
    label: 'Disqualified',
    color: 'error',
    icon: 'mdi-cancel',
  },
};

export function outcomeColor(outcome: string): string {
  return outcome === 'DNF' ? 'error' : 'warning';
}

export function toLocalTimeValue(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

export function stageName(stages: Stage[], stageId: string): string {
  return stages.find((stage) => stage.id === stageId)?.name ?? stageId;
}

export function vehicleName(vehicles: Vehicle[], vehicleId: string): string {
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  return vehicle ? `#${vehicle.startNumber} ${vehicle.driverName}` : vehicleId;
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
    case GateRole.STAGE_SPLIT:
      return `Split ${assignment.splitIndex ?? ''}`;
    default:
      return assignment.role;
  }
}
