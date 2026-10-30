export const BUZZER_SHORT_MS = 80;
export const BUZZER_LONG_MS = 400;
/** Silence after every tone, so repeated tones stay apart. */
export const BUZZER_GAP_MS = 100;
/** Silence between a signal and whatever sounds next, so two signals never run into one. */
export const BUZZER_SIGNAL_GAP_MS = 1000;

/**
 * Tone lengths in ms. A passing is a single 120ms beep and never one of these:
 * every signal holds a long tone, which a queue of passings cannot sound like.
 * The ESP32's "tap not stored" is 3x80ms and reserved. The firmware copies this
 * by hand (`firmware/esp32-gate/src/buzzer_signals.h`); a gate-agent test fails
 * when they differ.
 */
export const BUZZER_SIGNALS = {
  powerOn: [BUZZER_LONG_MS],
  ready: [BUZZER_SHORT_MS, BUZZER_SHORT_MS, BUZZER_LONG_MS],
  connectionLost: [BUZZER_LONG_MS, BUZZER_LONG_MS],
  clockUnsynced: [BUZZER_LONG_MS, BUZZER_LONG_MS, BUZZER_LONG_MS],
  hotspot: [BUZZER_LONG_MS, BUZZER_SHORT_MS],
  decoderFailed: [BUZZER_LONG_MS, BUZZER_SHORT_MS, BUZZER_LONG_MS],
  shutdown: [BUZZER_SHORT_MS, BUZZER_LONG_MS],
} as const satisfies Record<string, readonly number[]>;

export type BuzzerSignal = keyof typeof BUZZER_SIGNALS;

export function isBuzzerSignal(name: string): name is BuzzerSignal {
  return Object.prototype.hasOwnProperty.call(BUZZER_SIGNALS, name);
}
