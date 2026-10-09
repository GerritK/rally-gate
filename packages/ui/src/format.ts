import { t } from './i18n';

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

/** Clock time (start/finish/heartbeat instants): HH:MM:SS, 24h. Also the
 *  value of an `<input type="time" step="1">`; empty for no time. */
export function formatClockTime(iso?: string): string {
  if (!iso) return '';
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
 * Inverse of formatStageDuration, for a time read off a stopwatch:
 * `3:12.4`, `03:12.45`, `72.4`, `1:02:03.4`. Null unless it's a positive
 * duration.
 */
export function parseStageDuration(text: string): number | null {
  const match = /^(?:(?:(\d+):)?(\d+):)?(\d+(?:[.,]\d{1,3})?)$/.exec(
    text.trim(),
  );
  if (!match) return null;
  const [, h = '0', m = '0', s] = match;
  const ms = Math.round(
    (Number(h) * 3600 + Number(m) * 60 + Number(s.replace(',', '.'))) * 1000,
  );
  return ms > 0 ? ms : null;
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
  if (diffSec < 5) return t('ui.justNow');
  if (diffSec < 60) return t('ui.secondsAgo', { n: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('ui.minutesAgo', { n: diffMin });
  return t('ui.hoursAgo', { n: Math.floor(diffMin / 60) });
}
