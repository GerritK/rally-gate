import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { fromEvent, map, Observable } from 'rxjs';

@Controller('live')
export class LiveController {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  @Sse('detections')
  detections(): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, 'detection.created').pipe(
      map((data): MessageEvent => ({ data: data as object })),
    );
  }

  @Sse('stage-runs')
  stageRuns(): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, 'stage-run.updated').pipe(
      map((data): MessageEvent => ({ data: data as object })),
    );
  }

  @Sse('stage-run-splits')
  stageRunSplits(): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, 'stage-run.split').pipe(
      map((data): MessageEvent => ({ data: data as object })),
    );
  }

  @Sse('gates')
  gates(): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, 'gate.heartbeat').pipe(
      map((data): MessageEvent => ({ data: data as object })),
    );
  }

  /**
   * The backlog of detections that failed rule application, pushed whenever
   * it changes — a failure or a recovery. Carries the whole list rather than
   * a delta, so a client that reconnects mid-event is correct again on the
   * next change without needing replay.
   */
  @Sse('pending-detections')
  pendingDetections(): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, 'detection.pending-changed').pipe(
      map((data): MessageEvent => ({ data: data as object })),
    );
  }

  /** Unidentified passings waiting for a marshal — whole list per change. */
  @Sse('awaiting-detections')
  awaitingDetections(): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, 'detection.awaiting-changed').pipe(
      map((data): MessageEvent => ({ data: data as object })),
    );
  }
}
