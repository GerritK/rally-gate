/**
 * Rally timing conventions — distinct formats for distinct kinds of value,
 * not one generic "format a duration" function:
 * - Clock time (start/finish/heartbeat instants): HH:MM:SS, 24h, seconds
 *   included — these are electronically-recorded instants the correction
 *   UI edits to the second (see openTimePicker), not a paper time-card
 *   schedule where the minute is the actual granularity that matters.
 * - Special stage result (elapsed racing duration): HH:MM:SS.s or
 *   MM:SS.s. One decimal place (tenths), not raw millisecond precision.
 * - Intervals / target times (checkpoint-to-checkpoint travel budget):
 *   MM:SS or accumulated minutes. Not used yet — no time-control/interval
 *   feature exists in the app today (see "Parc Fermé / time control" in
 *   development-roadmap.md) — add a formatter here when that's built
 *   rather than reusing formatStageDuration for it.
 */

/** Clock time (start/finish/heartbeat instants): HH:MM:SS, 24h. */
export function formatClockTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Special stage result / elapsed racing duration: MM:SS.s, or HH:MM:SS.s
 * once it reaches an hour.
 */
export function formatStageDuration(ms: number): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const totalTenths = Math.round(ms / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const mmss = `${pad2(minutes)}:${pad2(seconds)}.${tenths}`;
  return hours > 0 ? `${pad2(hours)}:${mmss}` : mmss;
}

/**
 * Relative "how long ago" for freshness checks (gate heartbeats, that kind
 * of thing) — pass a live-ticking `now` from the caller (e.g. a ref updated
 * on a 1s interval) so the display keeps counting up without new data
 * arriving; a component that calls this with a static Date.now() will only
 * update on its next unrelated re-render.
 */
export function formatRelativeTime(iso: string, now: number): string {
  const diffSec = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}
