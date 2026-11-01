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

/**
 * How a car's start is timed (`docs/event-model.md` "Start slots"). Fixed
 * once the stage leaves NOT_STARTED, so a start never changes meaning mid-run.
 */
export enum StartMode {
  /** The start passing is the start time. */
  GATE = 'GATE',
  /** Slots from a timetable: first start + interval × position. Not on a shakedown. */
  SLOT_SCHEDULE = 'SLOT_SCHEDULE',
  /** A countdown per car; its slot is the start time. */
  SLOT_MANUAL = 'SLOT_MANUAL',
}

/**
 * A start passing this close to a slot belongs to it, even from a light
 * barrier: it sets no time, only the jump-start mark a marshal confirms.
 */
export const SLOT_PASSING_BEFORE_MS = 10_000;
export const SLOT_PASSING_AFTER_MS = 60_000;

/**
 * A pre-start detection older than this starts no countdown, only marks the
 * car at the start: a gate that was offline replays its taps on reconnect,
 * and a slot from now for a tap minutes old would be a phantom start.
 */
export const PRE_START_TRIGGER_MAX_AGE_MS = 30_000;

/** Whether a stage's start time is the slot rather than the start passing. */
export const isSlotStart = (mode: StartMode | undefined): boolean =>
  mode === StartMode.SLOT_MANUAL || mode === StartMode.SLOT_SCHEDULE;

/** A timetable stage that sets no `slotIntervalMs`. */
export const DEFAULT_SLOT_INTERVAL_MS = 60_000;
