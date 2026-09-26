import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LiveEventType } from '@rally-gate/shared';
import { fromEvent, map, merge, Observable } from 'rxjs';

/** Internal bus event behind each SSE event type. */
const LIVE_EVENTS: Record<LiveEventType, string> = {
  detection: 'detection.created',
  'stage-run': 'stage-run.updated',
  'stage-run-split': 'stage-run.split',
  gate: 'gate.heartbeat',
  // Whole lists rather than deltas, so a client that reconnects is correct
  // again on the next change without replay.
  'pending-detections': 'detection.pending-changed',
  'awaiting-detections': 'detection.awaiting-changed',
};

@Controller('live')
export class LiveController {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * One stream for everything, told apart by SSE event type. Not one stream
   * per kind: each open EventSource holds one of the browser's six HTTP/1.1
   * connections per host — shared across tabs — and once they're all streams,
   * every ordinary fetch queues behind them and the dashboard freezes.
   */
  @Sse()
  stream(): Observable<MessageEvent> {
    return merge(
      ...Object.entries(LIVE_EVENTS).map(([type, busEvent]) =>
        fromEvent(this.eventEmitter, busEvent).pipe(
          map((data): MessageEvent => ({ type, data: data as object })),
        ),
      ),
    );
  }
}
