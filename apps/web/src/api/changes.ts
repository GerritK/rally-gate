import type { ChangeView } from '@rally-gate/shared';
import { apiFetch } from './client';

/** Newest first: who changed this entry's results, and what stood before. */
export function fetchChanges(entryId: string): Promise<ChangeView[]> {
  return apiFetch(`/entries/${entryId}/changes`);
}
