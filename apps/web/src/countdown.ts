/**
 * The start countdown's arithmetic (`docs/event-model.md` "Countdown"), kept
 * free of Vue and the API so `node --test` covers it.
 */

export const START_LIGHTS = 5;

/** The tone that announces a slot: this long before it. */
export const ANNOUNCE_MS = 10_000;

/** Green stays up this long, so a driver who looks late still sees it. */
export const GREEN_HOLD_MS = 5_000;

export interface CountdownState {
  /** Red lights on, 0–5: all five 5 s before the slot, one out per second. */
  lit: number;
  green: boolean;
  /** Whole seconds to the slot, rounded up; 0 from the slot on. */
  secondsLeft: number;
}

export function countdownState(slotMs: number, nowMs: number): CountdownState {
  const leftMs = slotMs - nowMs;
  if (leftMs <= 0) return { lit: 0, green: true, secondsLeft: 0 };
  const secondsLeft = Math.ceil(leftMs / 1000);
  return {
    lit: secondsLeft <= START_LIGHTS ? secondsLeft : 0,
    green: false,
    secondsLeft,
  };
}

export interface Tone {
  atMs: number;
  long: boolean;
}

/** A tone 10 s out, one with each light, a long one on green; past ones dropped. */
export function toneTimes(slotMs: number, nowMs: number): Tone[] {
  return [
    { atMs: slotMs - ANNOUNCE_MS, long: false },
    ...Array.from({ length: START_LIGHTS }, (_, i) => ({
      atMs: slotMs - (START_LIGHTS - i) * 1000,
      long: false,
    })),
    { atMs: slotMs, long: true },
  ].filter((tone) => tone.atMs >= nowMs);
}

interface SlotRun {
  status: string;
  startTime: string;
  plannedStartTime: string | null;
}

/** Still at the line: before its slot, or showing green. Not yet on stage. */
export function isQueued(run: SlotRun | undefined, nowMs: number): boolean {
  return (
    run?.status === 'STARTED' &&
    !!run.plannedStartTime &&
    nowMs < new Date(run.plannedStartTime).getTime() + GREEN_HOLD_MS
  );
}

interface PassingRun {
  plannedStartTime: string | null;
  startPassingAt: string | null;
}

/** How early the car left, in ms; null when it wasn't a jump start. */
export function jumpStartMs(
  run: PassingRun,
  toleranceMs: number,
): number | null {
  if (!run.plannedStartTime || !run.startPassingAt) return null;
  const earlyMs =
    new Date(run.plannedStartTime).getTime() -
    new Date(run.startPassingAt).getTime();
  return earlyMs > toleranceMs ? earlyMs : null;
}
