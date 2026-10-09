// Setting keys, stored via `PUT /api/settings/:key`, with the default the
// server applies while one is unset — the web shows the same default until
// the stored value loads. Display and start-order keys sit beside their enums.

/** "false" ignores heartbeats from gates not added by hand. */
export const AUTO_DISCOVER_GATES_KEY = 'autoDiscoverGates';

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
