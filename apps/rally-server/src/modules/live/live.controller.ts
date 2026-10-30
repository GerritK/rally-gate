import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LiveEventType } from '@rally-gate/shared';
import { fromEvent, map, merge, Observable } from 'rxjs';
import { CurrentPrincipal, Public } from '../auth/auth.guard';
import type { Principal } from '../auth/auth.service';

/** Internal bus event behind each SSE event type. */
const LIVE_EVENTS: Record<LiveEventType, string> = {
  detection: 'detection.created',
  'stage-run': 'stage-run.updated',
  'stage-run-split': 'stage-run.split',
  gate: 'gate.heartbeat',
  'gate-pairing': 'gate.pairing-changed',
  // Whole lists rather than deltas, so a client that reconnects is correct
  // again on the next change without replay.
  'pending-detections': 'detection.pending-changed',
  'awaiting-detections': 'detection.awaiting-changed',
  rally: 'rally.updated',
};

/** What the public page needs; passings, transponders and gates are internal. */
const PUBLIC_LIVE_EVENTS: LiveEventType[] = [
  'stage-run',
  'stage-run-split',
  'rally',
];

@Controller('live')
export class LiveController {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * One stream for everything, told apart by SSE event type. Not one stream
   * per kind: each open EventSource holds one of the browser's six HTTP/1.1
   * connections per host — shared across tabs — and once they're all streams,
   * every ordinary fetch queues behind them and the dashboard freezes.
   * Without a login it carries `PUBLIC_LIVE_EVENTS` only.
   */
  @Public()
  @Sse()
  stream(
    @CurrentPrincipal() principal: Principal | null,
  ): Observable<MessageEvent> {
    return merge(
      ...Object.entries(LIVE_EVENTS)
        .filter(
          ([type]) =>
            principal || PUBLIC_LIVE_EVENTS.includes(type as LiveEventType),
        )
        .map(([type, busEvent]) =>
          fromEvent(this.eventEmitter, busEvent).pipe(
            map((data): MessageEvent => ({ type, data: data as object })),
          ),
        ),
    );
  }
}
