import {
  CLOCK_CORRECTION_THRESHOLD_KEY,
  DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS,
} from '@rally-gate/shared';
import { apiFetch, putJson } from './client';

export function fetchSetting(key: string): Promise<string | null> {
  return apiFetch<{ key: string; value: string } | null>(
    `/settings/${key}`,
  ).then((setting) => setting?.value ?? null);
}

export function saveSetting(key: string, value: string): Promise<void> {
  return putJson(`/settings/${key}`, { value }).then(() => undefined);
}

export async function fetchClockCorrectionThresholdMs(): Promise<number> {
  return (
    Number(await fetchSetting(CLOCK_CORRECTION_THRESHOLD_KEY)) ||
    DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS
  );
}
