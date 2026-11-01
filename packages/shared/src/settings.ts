// Setting keys, stored via `PUT /api/settings/:key`, with the default the
// server applies while one is unset — the web shows the same default until
// the stored value loads. Display and start-order keys sit beside their enums.

export const CLOCK_CORRECTION_THRESHOLD_KEY = 'clockCorrectionThresholdMs';

/**
 * Below this, a measured gate clock offset is indistinguishable from network
 * transit time (the measurement is one-way), so correcting would inject
 * latency noise into clocks that may well be fine. Above it, the gate's clock
 * is unambiguously wrong — an unsynced Pi drifts seconds over an event, and
 * one booting from `fake-hwclock` with no RTC can be days out.
 *
 * A setting because the right value depends on the site's network: the floor
 * is however long a heartbeat takes to arrive, a property of the rally's
 * Wi-Fi, not of this code.
 */
export const DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS = 1_000;

export const NOTIONAL_PENALTY_MS_KEY = 'notionalPenaltyMs';

/**
 * Added on top of the slowest real time in the ranking being computed, which
 * is what keeps a notional worse than every real time in it. Roughly a stage
 * duration, deliberately not a token few seconds: with a small penalty a
 * quick crew can retire and still lead the rally. A setting because the right
 * value scales with stage length, which the code can't know.
 */
export const DEFAULT_NOTIONAL_PENALTY_MS = 120_000;

export const COUNTDOWN_MS_KEY = 'countdownMs';

/** Shown before every slot; the start lights are always its last 5 s. */
export const DEFAULT_COUNTDOWN_MS = 10_000;

export const JUMP_START_TOLERANCE_MS_KEY = 'jumpStartToleranceMs';

/**
 * A start passing earlier than slot minus this is a jump start. Covers the
 * gate clock's sync error and the beam edge, not a driver's reaction time.
 */
export const DEFAULT_JUMP_START_TOLERANCE_MS = 200;

export const MIN_START_GAP_MS_KEY = 'minStartGapMs';

/** Manual slots queue at least this far apart: one start line, one car. */
export const DEFAULT_MIN_START_GAP_MS = 30_000;

/** A penalty type id; unset or empty means a jump start is only marked. */
export const JUMP_START_PENALTY_TYPE_ID_KEY = 'jumpStartPenaltyTypeId';
