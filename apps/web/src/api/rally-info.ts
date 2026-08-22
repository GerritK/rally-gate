import { apiFetch, putJson } from './client';

export interface RallyInfo {
  name: string;
  date?: string;
  location?: string;
}

export function fetchRallyInfo(): Promise<RallyInfo | null> {
  return apiFetch('/rally-info');
}

export function saveRallyInfo(input: RallyInfo): Promise<RallyInfo> {
  return putJson('/rally-info', input);
}
