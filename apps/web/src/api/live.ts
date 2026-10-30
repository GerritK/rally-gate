import type {
  GatePairingState,
  LiveEventType,
  RallyStatus,
} from '@rally-gate/shared';
import { ref } from 'vue';
import { API_BASE } from './client';
import type { DetectionEventRecord } from './events';
import type { Gate } from './gates';
import { applyRallyInfo, fetchRallyInfo, type RallyInfo } from './rally-info';
import type { StageRun, StageSplit } from './stage-runs';

interface LivePayloads {
  detection: DetectionEventRecord;
  'stage-run': StageRun;
  'stage-run-split': StageSplit;
  gate: Gate;
  'gate-pairing': GatePairingState;
  'pending-detections': { pending: DetectionEventRecord[] };
  'awaiting-detections': { awaiting: DetectionEventRecord[] };
  rally: RallyInfo & { status: RallyStatus };
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
 * Every stream also keeps the rally's status current for the app bar.
 */
export function openLiveStream(
  handlers: LiveHandlers,
  onOpen: () => void,
): EventSource {
  const source = new EventSource(`${API_BASE}/live`);
  liveStatus.value = 'connecting';
  source.onopen = () => {
    liveStatus.value = 'live';
    void fetchRallyInfo();
    onOpen();
  };
  // EventSource reconnects by itself; this is the gap until it does.
  source.onerror = () => {
    liveStatus.value = 'offline';
  };
  for (const [type, handler] of Object.entries({
    rally: applyRallyInfo,
    ...handlers,
  })) {
    source.addEventListener(type, (e) =>
      (handler as (data: unknown) => void)(
        JSON.parse((e as MessageEvent).data),
      ),
    );
  }
  return source;
}

/** Applies a pushed item to a loaded list: replaced where `key` matches,
 *  else added — at the front for a newest-first list. */
export function upsert<T>(
  list: T[],
  item: T,
  key: keyof T,
  { first = false } = {},
): void {
  const index = list.findIndex((existing) => existing[key] === item[key]);
  if (index !== -1) list[index] = item;
  else if (first) list.unshift(item);
  else list.push(item);
}

export function closeLiveStream(source: EventSource): void {
  source.close();
  liveStatus.value = null;
}
