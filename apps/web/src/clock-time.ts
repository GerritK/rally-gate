/**
 * Typed clock time to `HH:MM:SS` (24 h), the value `TimeInput` holds and
 * `combineDateAndTime()` reads; '' for an empty field, null if it isn't a
 * time. Lenient so a correction is typed fast: `14:03:27`, `14.03.27`,
 * `9:5:3`, `14:03` (seconds 00), or digits only — `140327`, `1403`, `14`.
 */
export function parseClockTime(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return '';
  let parts: string[];
  if (/^\d{1,6}$/.test(trimmed)) {
    // Digits only: pairs from the right, so a leading single digit is the hour.
    const padded = trimmed.length % 2 ? `0${trimmed}` : trimmed;
    parts = padded.match(/\d\d/g)!;
  } else {
    parts = trimmed.split(/\s*[:.,\s]\s*/);
    if (parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p)))
      return null;
  }
  const [h, m = 0, s = 0] = parts.map(Number);
  if (h > 23 || m > 59 || s > 59) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
