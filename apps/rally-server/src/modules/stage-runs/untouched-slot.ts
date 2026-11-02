import type { StageRun } from './stage-run.entity';

/**
 * A slot nobody drove yet: no start passing, finish or DNF. Splits are
 * checked apart, by the caller. Its own file: `StagesService.close` needs it,
 * and importing `stage-runs.service.ts` from there would be circular.
 */
export function isUntouchedSlot(run: StageRun): boolean {
  return (
    !!run.plannedStartTime && !run.startPassingAt && !run.finishTime && !run.dnf
  );
}
