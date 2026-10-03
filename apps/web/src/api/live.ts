import type { LiveEventType } from '@rally-gate/shared';
import { ref } from 'vue';
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
 * The open page's stream, for the app bar: `null` when the page has none.
 * Without it a dropped connection is silent and the page shows stale times.
 * Read off the page's own stream, never a second one: a browser allows six
 * connections per host, and every dashboard tab already holds one.
 */
export const liveStatus = ref<'connecting' | 'live' | 'offline' | null>(null);

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
  liveStatus.value = 'connecting';
  source.onopen = () => {
    liveStatus.value = 'live';
    onOpen();
  };
  // EventSource reconnects by itself; this is the gap until it does.
  source.onerror = () => {
    liveStatus.value = 'offline';
  };
  for (const [type, handler] of Object.entries(handlers)) {
    source.addEventListener(type, (e) =>
      (handler as (data: unknown) => void)(
        JSON.parse((e as MessageEvent).data),
      ),
    );
  }
  return source;
}

export function closeLiveStream(source: EventSource): void {
  source.close();
  liveStatus.value = null;
}
