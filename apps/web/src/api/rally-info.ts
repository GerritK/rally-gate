import { ref } from 'vue';
import { apiFetch, putJson } from './client';

export interface RallyInfo {
  name: string;
  date?: string;
  location?: string;
}

/** Kept current by the two calls below, so the app bar follows a rename in
 * Setup without a reload. */
export const rallyName = ref('');

export async function fetchRallyInfo(): Promise<RallyInfo | null> {
  const info = await apiFetch<RallyInfo | null>('/rally-info');
  rallyName.value = info?.name ?? '';
  return info;
}

/**
 * Destructured rather than passed straight through: callers hold the object
 * returned by `fetchRallyInfo`, which carries the server's singleton `id`
 * alongside the declared fields. The API rejects unknown properties, so
 * round-tripping it verbatim would 400.
 */
export async function saveRallyInfo({
  name,
  date,
  location,
}: RallyInfo): Promise<RallyInfo> {
  const info = await putJson<RallyInfo>('/rally-info', {
    name,
    date,
    location,
  });
  rallyName.value = info.name;
  return info;
}
