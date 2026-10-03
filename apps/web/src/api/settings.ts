import { apiFetch, putJson } from './client';

export function fetchSetting(key: string): Promise<string | null> {
  return apiFetch<{ key: string; value: string } | null>(
    `/settings/${key}`,
  ).then((setting) => setting?.value ?? null);
}

export function saveSetting(key: string, value: string): Promise<void> {
  return putJson(`/settings/${key}`, { value }).then(() => undefined);
}

/** Mirrors DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS; only used until the real
 * value arrives from settings, so the two can't drift in practice. */
export const CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS = 1_000;

export async function fetchClockCorrectionThresholdMs(): Promise<number> {
  return (
    Number(await fetchSetting('clockCorrectionThresholdMs')) ||
    CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS
  );
}
