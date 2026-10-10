import { RallyStatus } from '@rally-gate/shared';
import { computed, ref } from 'vue';
import { apiFetch, postRequest, putJson } from './client';

export interface RallyInfo {
  name: string;
  date?: string;
  location?: string;
}

/** Kept current by the calls below and by every page's live stream, so the
 * app bar follows a rename or a status change without a reload. */
export const rallyName = ref('');
export const rallyStatus = ref(RallyStatus.SETUP);

/** For a control the server refuses in these statuses (`@LockedWhen`);
 *  pair it with `RallyLockAlert` so the reason is on screen. */
export const lockedWhen = (...statuses: RallyStatus[]) =>
  computed(() => statuses.includes(rallyStatus.value));

export function applyRallyInfo(
  info: (RallyInfo & { status: RallyStatus }) | null,
): void {
  rallyName.value = info?.name ?? '';
  rallyStatus.value = info?.status ?? RallyStatus.SETUP;
}

export async function fetchRallyInfo(): Promise<RallyInfo | null> {
  const info = await apiFetch<(RallyInfo & { status: RallyStatus }) | null>(
    '/rally-info',
  );
  applyRallyInfo(info);
  return info;
}

/**
 * Destructured rather than passed straight through: callers hold the object
 * returned by `fetchRallyInfo`, which carries the server's singleton `id`
 * and `status` alongside the declared fields. The API rejects unknown
 * properties, so round-tripping it verbatim would 400.
 */
export async function saveRallyInfo({
  name,
  date,
  location,
}: RallyInfo): Promise<RallyInfo> {
  const info = await putJson<RallyInfo & { status: RallyStatus }>(
    '/rally-info',
    { name, date, location },
  );
  applyRallyInfo(info);
  return info;
}

/** `start`, `close` (409 while cars are on stage) or `reopen`. */
export async function changeRallyStatus(
  action: 'start' | 'close' | 'reopen',
): Promise<void> {
  applyRallyInfo(await postRequest(`/rally-info/${action}`));
}
