import type { StartOrder } from '@rally-gate/shared';
import { apiFetch, postRequest } from './client';

export type { StartOrder };

export function fetchStartOrder(stageId: string): Promise<StartOrder> {
  return apiFetch(`/stages/${stageId}/start-order`);
}

export function freezeStartOrder(stageId: string): Promise<StartOrder> {
  return postRequest(`/stages/${stageId}/start-order/freeze`);
}

/** 409 once the stage has been activated. */
export function unfreezeStartOrder(stageId: string): Promise<StartOrder> {
  return postRequest(`/stages/${stageId}/start-order/unfreeze`);
}
