import type {
  ClassificationEntry,
  OverallClassificationEntry,
  SplitClassificationEntry,
  SplitGateInfo,
  StageOutcomeEntry,
} from '@rally-gate/shared';
import { apiFetch } from './client';
import type { Vehicle } from './vehicles';

export type {
  ClassificationEntry,
  OverallClassificationEntry,
  SplitClassificationEntry,
  SplitGateInfo,
  StageOutcomeEntry,
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
): Promise<ClassificationEntry[]> {
  return apiFetch(`/classification/stages/${stageId}${classQuery(classIds)}`);
}

export function fetchOverallClassification(
  classIds?: string[],
): Promise<OverallClassificationEntry[]> {
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
): Promise<SplitClassificationEntry[]> {
  return apiFetch(
    `/classification/stages/${stageId}/splits/${splitIndex}${classQuery(classIds)}`,
  );
}

export function fetchNonFinishers(
  stageId: string,
  classIds?: string[],
): Promise<StageOutcomeEntry[]> {
  return apiFetch(
    `/classification/stages/${stageId}/non-finishers${classQuery(classIds)}`,
  );
}

/** Everything a stage's results card shows, for one ranking. */
export interface StageResults {
  classification: ClassificationEntry[];
  nonFinishers: StageOutcomeEntry[];
  splitGates: SplitGateInfo[];
  /** Per split gate (same order), each vehicle's split time and rank. While
   * the stage runs, the rank includes cars still on stage; once it closes, a
   * DNF's splits drop out server-side. */
  splitsByGate: Map<string, SplitClassificationEntry>[];
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
      (entries) => new Map(entries.map((e) => [e.vehicleId, e])),
    ),
  };
}

/** Fastest real time per counted stage, within one overall ranking. A
 * notional is slower than every real time by construction, so it never is
 * one. */
export function fastestByStage(
  entries: OverallClassificationEntry[],
): Map<string, number> {
  const best = new Map<string, number>();
  for (const entry of entries) {
    for (const t of entry.stageTimes) {
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
  entries: OverallClassificationEntry[],
  vehicles: Vehicle[],
  classIds: string[],
): Vehicle[] {
  const ranked = new Set(entries.map((e) => e.vehicleId));
  return vehicles
    .filter(
      (v) =>
        !ranked.has(v.id) &&
        classIds.every((id) => v.classes.some((c) => c.id === id)),
    )
    .sort((a, b) => a.startNumber - b.startNumber);
}
