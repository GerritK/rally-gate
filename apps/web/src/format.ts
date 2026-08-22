import { formatStageDuration } from '@rally-gate/ui';
import type { Gate } from './api/gates';
import type { Stage } from './api/stages';
import type { Vehicle } from './api/vehicles';

export const HEARTBEAT_ONLINE_THRESHOLD_MS = 30_000;

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

export function formatDuration(ms?: number): string {
  return ms === undefined ? '-' : formatStageDuration(ms);
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
    default:
      return 'timing-idle';
  }
}

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
