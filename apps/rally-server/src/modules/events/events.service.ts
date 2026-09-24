import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DetectionEvent,
  DETECTION_TOPIC_PREFIX,
  GateRole,
  StageStatus,
} from '@rally-gate/shared';
import { Repository } from 'typeorm';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { Gate } from '../gates/gate.entity';
import { GatesService } from '../gates/gates.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { StageRunsService } from '../stage-runs/stage-runs.service';
import { StagesService } from '../stages/stages.service';
import { DetectionEventRecord } from './detection-event.entity';

const DETECTION_TOPIC_REGEX = new RegExp(
  `^${DETECTION_TOPIC_PREFIX}/([^/]+)/detections$`,
);

/**
 * How often to retry detections whose rule application failed. Well under a
 * stage's duration, so a transient DB error (SQLITE_BUSY under a burst, a
 * momentarily full disk) recovers before the car reaches the finish gate and
 * the run is still built from the right timestamps.
 */
export const REPROCESS_INTERVAL_MS = 30_000;

/**
 * Long enough for any real transponder or gate id, short enough that a
 * malformed publisher can't fill the event database one detection at a time.
 */
const MAX_ID_LENGTH = 128;

/**
 * MQTT is the one ingress the global `ValidationPipe` doesn't cover, and the
 * broker is unauthenticated — anything on the rally network can publish to a
 * gate topic. An unparseable `timestampGate` silently poisons a run's
 * duration rather than throwing, and a missing `eventId` fails the insert and
 * lands in the pending list forever. Returns null for anything malformed.
 */
function parseDetection(payload: unknown): DetectionEvent | null {
  const { eventId, gateId, transponderId, timestampGate, source } = (payload ??
    {}) as Record<string, unknown>;

  const isUsableId = (value: unknown): value is string =>
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH;

  if (
    !isUsableId(eventId) ||
    !isUsableId(gateId) ||
    !isUsableId(transponderId)
  ) {
    return null;
  }
  if (
    typeof timestampGate !== 'string' ||
    Number.isNaN(new Date(timestampGate).getTime())
  ) {
    return null;
  }

  return {
    eventId,
    gateId,
    transponderId,
    timestampGate,
    source: typeof source === 'string' ? source.slice(0, MAX_ID_LENGTH) : '',
  };
}

@Injectable()
export class EventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);
  private reprocessTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(DetectionEventRecord)
    private readonly events: Repository<DetectionEventRecord>,
    private readonly gatesService: GatesService,
    private readonly gateAssignmentsService: GateAssignmentsService,
    private readonly vehiclesService: VehiclesService,
    private readonly stageRunsService: StageRunsService,
    private readonly stagesService: StagesService,
    private readonly emitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.reprocessTimer = setInterval(() => {
      void this.reprocessPending();
    }, REPROCESS_INTERVAL_MS);
  }

  onModuleDestroy() {
    clearInterval(this.reprocessTimer);
  }

  findRecent(limit = 100): Promise<DetectionEventRecord[]> {
    return this.events.find({
      order: { timestampServer: 'DESC' },
      take: limit,
    });
  }

  /**
   * Detections whose rule application failed. The raw detection is safe —
   * it's written before the rules run — but no `StageRun` was built from it,
   * so these are exactly the passings that exist in the database yet are
   * missing from the timing.
   */
  findPending(): Promise<DetectionEventRecord[]> {
    return this.events.find({
      where: { processed: false },
      order: { timestampGate: 'ASC' },
    });
  }

  /**
   * Retries rule application for detections that previously failed, oldest
   * first so a start is replayed before the finish that depends on it.
   *
   * Safe to run repeatedly: the rule engine is idempotent by design
   * (`startRun`/`finishRun`/`recordSplit` all ignore repeats), so a detection
   * whose rules did partially apply won't double-count.
   *
   * ponytail: no attempt cap or backoff — a permanently failing record
   * retries every interval and logs each time. The pending count makes that
   * visible rather than silent, which is the point; add a cap if a real
   * event ever produces a stuck record.
   */
  async reprocessPending(): Promise<number> {
    const pending = await this.findPending();
    if (pending.length === 0) {
      return 0;
    }
    this.logger.log(`Retrying ${pending.length} unprocessed detection(s)`);
    let recovered = 0;
    for (const record of pending) {
      if (await this.applyRulesForRecord(record)) {
        recovered += 1;
      }
    }
    if (recovered > 0) {
      this.logger.log(`Recovered ${recovered} detection(s)`);
      await this.emitPendingChanged();
    }
    return recovered;
  }

  /**
   * Publishes the current backlog to the live feed, so the dashboard learns
   * about a failure the moment it happens instead of asking on a timer. Same
   * shape as every other cross-cutting signal here — emit, and let
   * `LiveController` be the thing that listens.
   *
   * Never throws: this runs from the catch path of an ingest that is already
   * going wrong, and failing to refresh a banner must not compound that.
   */
  private async emitPendingChanged(): Promise<void> {
    try {
      this.emitter.emit('detection.pending-changed', {
        pending: await this.findPending(),
      });
    } catch (err) {
      this.logger.warn(
        `Could not publish the pending-detection backlog: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @OnEvent('mqtt.message')
  async handleMqttMessage({
    topic,
    payload,
  }: {
    topic: string;
    payload: Buffer;
  }) {
    const match = DETECTION_TOPIC_REGEX.exec(topic);
    if (!match) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.toString());
    } catch {
      this.logger.warn(`Ignoring malformed detection payload on ${topic}`);
      return;
    }
    const detection = parseDetection(parsed);
    if (!detection) {
      this.logger.warn(
        `Ignoring detection on ${topic} with missing or invalid fields — expected non-empty eventId, gateId, transponderId and a parseable timestampGate`,
      );
      return;
    }
    await this.processDetection(detection);
  }

  private async processDetection(detection: DetectionEvent): Promise<void> {
    const gate = await this.gatesService.findOne(detection.gateId);
    if (!gate) {
      this.logger.warn(
        `Detection from unknown gate ${detection.gateId}, storing without processing`,
      );
    }
    const vehicle = await this.vehiclesService.findByTransponder(
      detection.transponderId,
    );
    if (!vehicle) {
      this.logger.warn(
        `Detection for unregistered transponder ${detection.transponderId}`,
      );
    }

    // Gate clocks are independent of each other and of the server's, so a
    // duration built from two gates' raw timestamps carries their
    // disagreement. Correct onto server time here, at ingest, and keep both
    // halves — see "Clock offset" in docs/architecture.md.
    const clockCorrectionMs = gate
      ? await this.gatesService.clockCorrectionMsFor(gate)
      : 0;
    const timestampGate = new Date(detection.timestampGate);

    const record = this.events.create({
      eventId: detection.eventId,
      gateId: detection.gateId,
      transponderId: detection.transponderId,
      vehicleId: vehicle?.id,
      timestampGate,
      timestampServer: new Date(),
      clockCorrectionMs,
      rawPayload: JSON.stringify(detection),
      processed: false,
    });
    await this.events.save(record);
    this.emitter.emit('detection.created', record);

    await this.applyRulesForRecord(record);
  }

  /**
   * Applies the rule engine to a stored detection and marks it processed,
   * shared by the live path and the retry sweep so the two can't drift.
   *
   * Failures are swallowed rather than rethrown: the raw detection is already
   * saved, so leaving `processed` false makes it retryable and countable,
   * where a throw would just be discarded by `@nestjs/event-emitter`
   * (handlers default to `suppressErrors: true`).
   *
   * Returns whether the detection is now processed.
   */
  private async applyRulesForRecord(
    record: DetectionEventRecord,
  ): Promise<boolean> {
    try {
      const gate = await this.gatesService.findOne(record.gateId);
      // An unknown gate or unregistered transponder is not a failure —
      // there's nothing to apply and retrying won't change that, so it's
      // marked processed to keep the pending list to real problems.
      if (gate && record.vehicleId) {
        await this.applyRules(
          gate,
          record.vehicleId,
          new Date(record.timestampGate.getTime() + record.clockCorrectionMs),
        );
      }
      record.processed = true;
      await this.events.save(record);
      return true;
    } catch (err) {
      this.logger.error(
        `Rule application failed for detection ${record.eventId} from gate ${record.gateId}; it is stored but not timed, and will be retried`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.emitPendingChanged();
      return false;
    }
  }

  private async applyRules(
    gate: Gate,
    vehicleId: string,
    at: Date,
  ): Promise<void> {
    const assignment = await this.gateAssignmentsService.findActiveForGate(
      gate.id,
    );
    if (!assignment) {
      return;
    }
    const stageId = assignment.stageId;

    // `GateAssignment.active` and `Stage.status` are two records kept in step
    // by `StagesService` in separate steps, so a crash between them leaves a
    // gate live on a stage that isn't. Checking both means a detection in that
    // window is stored untimed rather than attached to a dormant stage.
    const stage = await this.stagesService.findOne(stageId);
    if (stage?.status !== StageStatus.ACTIVE) {
      this.logger.warn(
        `Gate ${gate.id} is assigned to stage ${stageId}, which is ${stage?.status ?? 'missing'} rather than ACTIVE — storing the detection without timing it`,
      );
      return;
    }
    if (assignment.role === GateRole.STAGE_START) {
      const run = await this.stageRunsService.startRun(vehicleId, stageId, at);
      this.emitter.emit('stage-run.updated', run);
    } else if (assignment.role === GateRole.STAGE_FINISH) {
      const run = await this.stageRunsService.finishRun(vehicleId, stageId, at);
      if (run) {
        this.emitter.emit('stage-run.updated', run);
      }
    } else if (assignment.role === GateRole.STAGE_SPLIT) {
      const split = await this.stageRunsService.recordSplit(
        vehicleId,
        stageId,
        gate.id,
        assignment.splitIndex ?? 0,
        at,
      );
      if (split) {
        this.emitter.emit('stage-run.split', split);
      }
    }
  }
}
