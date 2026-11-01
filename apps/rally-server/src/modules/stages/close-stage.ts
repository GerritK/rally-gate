import { isOutOfEvent, StageScoring } from '@rally-gate/shared';
import { EntityManager, In, IsNull } from 'typeorm';
import { Entry } from '../entries/entry.entity';
import { DidNotStart } from '../stage-runs/did-not-start.entity';
import { StageRun } from '../stage-runs/stage-run.entity';
import { StageSplit } from '../stage-runs/stage-split.entity';
import { isUntouchedSlot } from '../stage-runs/untouched-slot';
import { Stage } from './stage.entity';

/**
 * Everything closing writes, in the transaction that sets the status, so
 * DNF and DNS rest on stored rows from then on: every open run DNF; a slot
 * nobody drove (no start passing, no split) deleted and DNS instead; a DNS
 * row for every car still without a counting run. None on a shakedown, and
 * none for a car out of the event, which is neither.
 */
export async function writeClose(manager: EntityManager, stage: Stage) {
  const saved = await manager.save(Stage, stage);
  const open = await manager.find(StageRun, {
    where: {
      stageId: stage.id,
      voided: false,
      retired: false,
      finishTime: IsNull(),
    },
  });
  const withSplits = new Set(
    (open.length > 0
      ? await manager.find(StageSplit, {
          where: { stageRunId: In(open.map((run) => run.id)) },
        })
      : []
    ).map((split) => split.stageRunId),
  );
  const unstarted = open.filter(
    (run) => isUntouchedSlot(run) && !withSplits.has(run.id),
  );
  const retired = open.filter((run) => !unstarted.includes(run));
  if (retired.length > 0) {
    await manager.update(
      StageRun,
      { id: In(retired.map((run) => run.id)) },
      { retired: true },
    );
  }
  if (unstarted.length > 0) {
    await manager.delete(StageRun, { id: In(unstarted.map((run) => run.id)) });
  }
  let dns: DidNotStart[] = [];
  if (stage.scoring !== StageScoring.NONE) {
    const counted = new Set(
      [
        ...(await manager.find(StageRun, {
          where: { stageId: stage.id, voided: false },
        })),
        ...(await manager.find(DidNotStart, { where: { stageId: stage.id } })),
      ].map((row) => row.entryId),
    );
    dns = (await manager.find(Entry))
      .filter((entry) => !isOutOfEvent(entry.status) && !counted.has(entry.id))
      .map((entry) => ({ entryId: entry.id, stageId: stage.id }));
    if (dns.length > 0) await manager.insert(DidNotStart, dns);
  }
  return { saved, retired, unstarted, dns };
}
