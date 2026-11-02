/**
 * A correction is typed as a time of day and dated from the run, so a run
 * across midnight puts one end on the wrong day. These move it a calendar
 * day (`setDate`, not 24 h, so a DST night keeps the typed time) only when
 * that gives a plausible stage time; otherwise the typed day stays and the
 * server refuses it, so a typo never becomes a stage time of nearly a day.
 */

/** Longer than any stage, shorter than the day a typo would add. */
const MAX_SHIFTED_STAGE_MS = 12 * 60 * 60 * 1000;

/** `finish` on the day, of its own and the two beside it, that ends a plausible stage started at `start`. */
export function finishAfter(start: string, finish: string): string {
  return onPlausibleDay(finish, (ms) => ms - Date.parse(start));
}

/** `start` on the day, of its own and the two beside it, that begins a plausible stage finished at `finish`. */
export function startBefore(finish: string, start: string): string {
  return onPlausibleDay(start, (ms) => Date.parse(finish) - ms);
}

function onPlausibleDay(time: string, stageMs: (ms: number) => number): string {
  for (const days of [0, 1, -1]) {
    const d = new Date(time);
    d.setDate(d.getDate() + days);
    const ms = stageMs(d.getTime());
    if (ms > 0 && ms < MAX_SHIFTED_STAGE_MS) return d.toISOString();
  }
  return time;
}
