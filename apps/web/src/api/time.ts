import { apiFetch } from './client';

/**
 * Server clock minus this device's, in ms. Gates sync to the server, so a
 * time a marshal reads off a tablet with a drifting clock would be off by
 * that much. Halving the round trip assumes symmetric latency, which is
 * plenty for a clock read to the second.
 */
export async function measureServerOffsetMs(): Promise<number> {
  const sentAt = Date.now();
  const { now } = await apiFetch<{ now: string }>('/time');
  const receivedAt = Date.now();
  return new Date(now).getTime() - (sentAt + receivedAt) / 2;
}
