/** The SSE `event:` names on `GET /api/live`, one per kind of live update. */
export type LiveEventType =
  | 'detection'
  | 'stage-run'
  | 'stage-run-deleted'
  | 'stage-run-split'
  /** `{ entryId, stageId, dns }`: a DNS row written (`dns: true`) or deleted. */
  | 'dns'
  | 'gate'
  | 'gate-pairing'
  | 'pending-detections'
  | 'awaiting-detections'
  | 'rally'
  /** `{ stageId }`: its stage or start order changed, slot times included. */
  | 'stage';
