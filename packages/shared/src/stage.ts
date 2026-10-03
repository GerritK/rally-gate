/**
 * On a combined start/finish gate, a passing this soon after the start is
 * the same passing reported twice, or the car pulling away after Start now,
 * never the finish. Used when the stage sets no `minDurationMs`.
 */
export const DEFAULT_MIN_STAGE_DURATION_MS = 10_000;

export enum StageStatus {
  NOT_STARTED = 'NOT_STARTED',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}
