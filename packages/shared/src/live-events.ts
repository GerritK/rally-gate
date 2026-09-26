/** The SSE `event:` names on `GET /api/live`, one per kind of live update. */
export type LiveEventType =
  | 'detection'
  | 'stage-run'
  | 'stage-run-split'
  | 'gate'
  | 'pending-detections'
  | 'awaiting-detections';
