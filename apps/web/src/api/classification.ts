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

export function fetchStageClassification(
  stageId: string,
): Promise<ClassificationEntry[]> {
  return apiFetch(`/classification/stages/${stageId}`);
}

export function fetchOverallClassification(): Promise<
  OverallClassificationEntry[]
> {
  return apiFetch('/classification/overall');
}

export function fetchSplitGatesForStage(
  stageId: string,
): Promise<SplitGateInfo[]> {
  return apiFetch(`/classification/stages/${stageId}/split-gates`);
}

export function fetchSplitClassification(
  stageId: string,
  splitIndex: number,
): Promise<SplitClassificationEntry[]> {
  return apiFetch(`/classification/stages/${stageId}/splits/${splitIndex}`);
}

export function fetchNonFinishers(
  stageId: string,
): Promise<StageOutcomeEntry[]> {
  return apiFetch(`/classification/stages/${stageId}/non-finishers`);
}
