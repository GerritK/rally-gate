import type { RunSnapshot } from '@rally-gate/shared';
import type { EntityManager } from 'typeorm';
import type { StageRun } from '../stage-runs/stage-run.entity';
import { ChangeRecord } from './change-record.entity';

/** Pass the transaction's manager, so change and record land together. */
export async function recordChange(
  manager: EntityManager,
  deviceId: string | null,
  change: Pick<ChangeRecord, 'action' | 'entryId' | 'stageId' | 'subjectId'> &
    Partial<Pick<ChangeRecord, 'before' | 'after'>>,
): Promise<void> {
  await manager.insert(ChangeRecord, {
    at: new Date(),
    deviceId,
    before: null,
    after: null,
    ...change,
  });
}

export const runSnapshot = (run: StageRun): RunSnapshot => ({
  attempt: run.attempt,
  startTime: run.startTime.toISOString(),
  finishTime: run.finishTime?.toISOString() ?? null,
});
