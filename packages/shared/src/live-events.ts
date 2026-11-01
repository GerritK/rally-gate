/** The SSE `event:` names on `GET /api/live`, one per kind of live update. */
export type LiveEventType =
  | 'detection'
  | 'stage-run'
  | 'stage-run-deleted'
  | 'stage-run-split'
  | 'gate'
  | 'gate-pairing'
  | 'pending-detections'
  | 'awaiting-detections'
  | 'rally'
  /** `{ stageId }`: its stage or start order changed, slot times included. */
  | 'stage';
