import type {
  Placing,
  OverallPlacing,
  SplitPlacing,
  SplitGateInfo,
  StageOutcome,
} from '@rally-gate/shared';
import { apiFetch } from './client';
import type { Entry } from './entries';

export type {
  Placing,
  OverallPlacing,
  SplitPlacing,
  SplitGateInfo,
  StageOutcome,
};

/** Every ranking takes optional classes, combined as an intersection
 * (Stock + Rookie + 2WD): positions and gaps (and the overall's notional
 * times) are then computed within that group. */
function classQuery(classIds: string[] = []): string {
  const query = new URLSearchParams(classIds.map((id) => ['classId', id]));
  return classIds.length > 0 ? `?${query}` : '';
}

export function fetchStageClassification(
  stageId: string,
  classIds?: string[],
): Promise<Placing[]> {
  return apiFetch(`/classification/stages/${stageId}${classQuery(classIds)}`);
}

export function fetchOverallClassification(
  classIds?: string[],
): Promise<OverallPlacing[]> {
  return apiFetch(`/classification/overall${classQuery(classIds)}`);
}

export function fetchSplitGatesForStage(
  stageId: string,
): Promise<SplitGateInfo[]> {
  return apiFetch(`/classification/stages/${stageId}/split-gates`);
}

export function fetchSplitClassification(
  stageId: string,
  splitIndex: number,
  classIds?: string[],
): Promise<SplitPlacing[]> {
  return apiFetch(
    `/classification/stages/${stageId}/splits/${splitIndex}${classQuery(classIds)}`,
  );
}

export function fetchNonFinishers(
  stageId: string,
  classIds?: string[],
): Promise<StageOutcome[]> {
  return apiFetch(
    `/classification/stages/${stageId}/non-finishers${classQuery(classIds)}`,
  );
}

/** Everything a stage's results card shows, for one ranking. */
export interface StageResults {
  classification: Placing[];
  nonFinishers: StageOutcome[];
  splitGates: SplitGateInfo[];
  /** Per split gate (same order), each entry's split time and rank. While
   * the stage runs, the rank includes cars still on stage; once it closes, a
   * DNF's splits drop out server-side. */
  splitsByGate: Map<string, SplitPlacing>[];
}

export async function fetchStageResults(
  stageId: string,
  classIds: string[],
): Promise<StageResults> {
  const [classification, nonFinishers, splitGates] = await Promise.all([
    fetchStageClassification(stageId, classIds),
    fetchNonFinishers(stageId, classIds),
    fetchSplitGatesForStage(stageId),
  ]);
  const splits = await Promise.all(
    splitGates.map((g) =>
      fetchSplitClassification(stageId, g.splitIndex, classIds),
    ),
  );
  return {
    classification,
    nonFinishers,
    splitGates,
    splitsByGate: splits.map(
      (placings) => new Map(placings.map((e) => [e.entryId, e])),
    ),
  };
}

/** Fastest real time per counted stage, within one overall ranking. A
 * notional is slower than every real time by construction, so it never is
 * one. */
export function fastestByStage(
  placings: OverallPlacing[],
): Map<string, number> {
  const best = new Map<string, number>();
  for (const placing of placings) {
    for (const t of placing.stageTimes) {
      if (!t.notional && t.durationMs < (best.get(t.stageId) ?? Infinity)) {
        best.set(t.stageId, t.durationMs);
      }
    }
  }
  return best;
}

/** In the classes but not in the overall: no completed closed stage yet.
 * Listed without a total: one made of notionals alone is what
 * event-model.md "Notional times" rules out. */
export function notClassified(
  placings: OverallPlacing[],
  entries: Entry[],
  classIds: string[],
): Entry[] {
  const ranked = new Set(placings.map((e) => e.entryId));
  return entries
    .filter(
      (v) =>
        !ranked.has(v.id) &&
        classIds.every((id) => v.classes.some((c) => c.id === id)),
    )
    .sort((a, b) => a.startNumber - b.startNumber);
}
