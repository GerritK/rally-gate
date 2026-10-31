import { StageRunStatus } from '@rally-gate/shared';

// Structural, so this runs under `node --test` (see passing-suggestions.ts).
interface RunLike {
  voided: boolean;
  status: StageRunStatus;
  durationMs?: number | null;
}

/**
 * The run to show for one car on one stage: the one on stage, else the
 * fastest finished, else whatever is left (a DNF). Only a shakedown has more
 * than one non-voided run; on any other stage this is simply that one.
 */
export function countingRun<T extends RunLike>(runs: T[]): T | undefined {
  const counting = runs.filter((r) => !r.voided);
  const fastest = counting
    .filter((r) => r.durationMs != null)
    .sort((a, b) => a.durationMs! - b.durationMs!)[0];
  return (
    counting.find((r) => r.status === StageRunStatus.STARTED) ??
    fastest ??
    counting[0]
  );
}
