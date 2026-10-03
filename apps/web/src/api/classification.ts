import type {
  ClassificationEntry,
  OverallClassificationEntry,
  SplitClassificationEntry,
  SplitGateInfo,
  StageOutcomeEntry,
} from '@rally-gate/shared';
import { apiFetch } from './client';

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
