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

/**
 * Whether a stage's times reach anything beyond its own results. Only
 * `OVERALL` stages count toward the overall, its notionals and penalties
 * tiered across the rally; a `QUALIFYING` stage may order the first counted
 * stage's start list, a `NONE` one (shakedown) nothing at all.
 */
export enum StageScoring {
  OVERALL = 'OVERALL',
  QUALIFYING = 'QUALIFYING',
  NONE = 'NONE',
}
