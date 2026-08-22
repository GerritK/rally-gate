import { apiFetch, putJson } from './client';

export interface RallyInfo {
  name: string;
  date?: string;
  location?: string;
}

export function fetchRallyInfo(): Promise<RallyInfo | null> {
  return apiFetch('/rally-info');
}

/**
 * Destructured rather than passed straight through: callers hold the object
 * returned by `fetchRallyInfo`, which carries the server's singleton `id`
 * alongside the declared fields. The API rejects unknown properties, so
 * round-tripping it verbatim would 400.
 */
export function saveRallyInfo({
  name,
  date,
  location,
}: RallyInfo): Promise<RallyInfo> {
  return putJson('/rally-info', { name, date, location });
}
