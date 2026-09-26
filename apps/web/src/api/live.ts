import type { LiveEventType } from '@rally-gate/shared';
import { API_BASE } from './client';
import type { DetectionEventRecord } from './events';
import type { Gate } from './gates';
import type { StageRun, StageSplit } from './stage-runs';

interface LivePayloads {
  detection: DetectionEventRecord;
  'stage-run': StageRun;
  'stage-run-split': StageSplit;
  gate: Gate;
  'pending-detections': { pending: DetectionEventRecord[] };
  'awaiting-detections': { awaiting: DetectionEventRecord[] };
}

export type LiveHandlers = {
  [K in LiveEventType]?: (data: LivePayloads[K]) => void;
};

/**
 * One EventSource per page, whatever it listens to — see the server's
 * LiveController for why a stream per kind freezes the dashboard.
 *
 * `onOpen` fires on the first connect and on every automatic reconnect, i.e.
 * exactly when events may have been missed, so it is where a page refetches.
 */
export function openLiveStream(
  handlers: LiveHandlers,
  onOpen: () => void,
): EventSource {
  const source = new EventSource(`${API_BASE}/live`);
  source.onopen = onOpen;
  for (const [type, handler] of Object.entries(handlers)) {
    source.addEventListener(type, (e) =>
      (handler as (data: unknown) => void)(
        JSON.parse((e as MessageEvent).data),
      ),
    );
  }
  return source;
}
