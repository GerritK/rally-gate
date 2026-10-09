import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApiErrorCode,
  DEFAULT_MIN_STAGE_DURATION_MS,
  DETECTION_TOPIC_PREFIX,
  DetectionEvent,
  GateRole,
  isOutOfEvent,
  StageStatus,
  TransponderKind,
} from '@rally-gate/shared';
import { In, Repository } from 'typeorm';
import { apiError } from '../../common/api-error';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { Gate } from '../gates/gate.entity';
import { GatesService } from '../gates/gates.service';
import { EntriesService } from '../entries/entries.service';
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
 * A real detection is a few hundred bytes. The cap leaves room for `metadata`
 * (the ESP32 gate's `timeUnknown`), which is stored verbatim as evidence and
 * otherwise unbounded on an unauthenticated broker.
 */
const MAX_PAYLOAD_BYTES = 4096;

/**
 * MQTT is the one ingress the global `ValidationPipe` doesn't cover, and the
 * broker is unauthenticated — anything on the rally network can publish to a
 * gate topic. An unparseable `timestampGate` silently poisons a run's
 * duration rather than throwing, and a missing `eventId` fails the insert and
 * lands in the pending list forever. Returns null for anything malformed.
 *
 * `transponderId` may be absent — a light barrier sees a passing without
 * identifying it — but if present it must be a usable id. An absent
 * `transponderKind` is RC; an unknown one is refused rather than guessed.
 */
function parseDetection(payload: unknown): DetectionEvent | null {
  const {
    eventId,
    gateId,
    transponderId,
    transponderKind = TransponderKind.RC,
    timestampGate,
    source,
  } = (payload ?? {}) as Record<string, unknown>;

  const isUsableId = (value: unknown): value is string =>
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH;

  if (!isUsableId(eventId) || !isUsableId(gateId)) {
    return null;
  }
  if (transponderId !== undefined && !isUsableId(transponderId)) {
    return null;
  }
  if (
    !Object.values(TransponderKind).includes(transponderKind as TransponderKind)
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
    transponderKind: transponderKind as TransponderKind,
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
    private readonly entriesService: EntriesService,
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

  findRecent(gateId?: string, limit = 100): Promise<DetectionEventRecord[]> {
    return this.events.find({
      where: gateId ? { gateId } : {},
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

  /** Unidentified passings waiting for a marshal, oldest first. */
  findAwaitingEntry(): Promise<DetectionEventRecord[]> {
    return this.events.find({
      where: { awaitingEntry: true },
      order: { timestampGate: 'ASC' },
    });
  }

  /**
   * Times an unidentified passing as the given entry. Refuses rather than
   * silently consuming it when the rules would do nothing — a finish for a car
   * that never started, a start for one already running, a stage no longer
   * live — so the marshal hears about it while the passing is still listed.
   */
  async assignEntry(
    eventId: string,
    entryId: string,
  ): Promise<DetectionEventRecord> {
    const record = await this.findAwaitingOrThrow(eventId);
    if (!(await this.entriesService.findOne(entryId))) {
      throw new NotFoundException(
        apiError(ApiErrorCode.ENTRY_NOT_FOUND, `Entry ${entryId} not found`),
      );
    }
    const gate = await this.gatesService.findOne(record.gateId);
    const applied =
      gate && (await this.applyRules(gate, entryId, effectiveTime(record)));
    if (!applied) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.PASSING_NOT_TIMEABLE,
          `This passing can't be timed for that entry: its stage is no longer active, the entry is withdrawn or disqualified, or it has no matching run (a finish or split needs its start assigned first)`,
        ),
      );
    }
    record.entryId = entryId;
    record.awaitingEntry = false;
    record.processed = true;
    await this.events.save(record);
    await this.emitAwaitingChanged();
    return record;
  }

  /**
   * A closed stage's unassigned passings can no longer be timed (assign 409s
   * on a closed stage), and once a gate is reused by another stage they'd be
   * read as that stage's. So they leave the list; the records stay as
   * evidence. Live Timing's close confirmation says how many.
   */
  @OnEvent('stage.closed')
  async discardPassingsOfClosedStage({
    stageId,
    gateIds,
  }: {
    stageId: string;
    gateIds: string[];
  }): Promise<void> {
    if (gateIds.length === 0) return;
    const { affected } = await this.events.update(
      { awaitingEntry: true, gateId: In(gateIds) },
      { awaitingEntry: false },
    );
    if (affected) {
      this.logger.warn(
        `Discarded ${affected} unassigned passing(s) on closed stage ${stageId}`,
      );
      await this.emitAwaitingChanged();
    }
  }

  /** For a passing that was no car at all: a marshal, a dog, a double trigger. */
  async dismissAwaiting(eventId: string): Promise<DetectionEventRecord> {
    const record = await this.findAwaitingOrThrow(eventId);
    record.awaitingEntry = false;
    await this.events.save(record);
    await this.emitAwaitingChanged();
    return record;
  }

  private async findAwaitingOrThrow(
    eventId: string,
  ): Promise<DetectionEventRecord> {
    const record = await this.events.findOneBy({ eventId });
    if (!record?.awaitingEntry) {
      throw new NotFoundException(
        apiError(
          ApiErrorCode.PASSING_NOT_WAITING,
          `No passing ${eventId} is waiting for an entry`,
        ),
      );
    }
    return record;
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

  /** Whole list, like the pending backlog, so a reconnecting client is right
   *  again on the next change. Never throws, for the same reason. */
  private async emitAwaitingChanged(): Promise<void> {
    try {
      this.emitter.emit('detection.awaiting-changed', {
        awaiting: await this.findAwaitingEntry(),
      });
    } catch (err) {
      this.logger.warn(
        `Could not publish the unassigned passings: ${
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
    if (payload.length > MAX_PAYLOAD_BYTES) {
      this.logger.warn(
        `Ignoring ${payload.length}-byte detection payload on ${topic} (limit ${MAX_PAYLOAD_BYTES})`,
      );
      return;
    }
    const raw = payload.toString();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn(`Ignoring malformed detection payload on ${topic}`);
      return;
    }
    const detection = parseDetection(parsed);
    if (!detection) {
      this.logger.warn(
        `Ignoring detection on ${topic} with missing or invalid fields — expected non-empty eventId and gateId, a usable transponderId if any, a known transponderKind if any, and a parseable timestampGate`,
      );
      return;
    }
    await this.processDetection(detection, raw);
  }

  private async processDetection(
    detection: DetectionEvent,
    rawPayload: string,
  ): Promise<void> {
    if (await this.isDuplicate(detection.eventId)) {
      return;
    }
    const gate = await this.gatesService.findOne(detection.gateId);
    if (!gate) {
      this.logger.warn(
        `Detection from unknown gate ${detection.gateId}, storing without processing`,
      );
    }
    const { transponderId } = detection;
    const transponderKind = transponderId
      ? (detection.transponderKind ?? TransponderKind.RC)
      : null;
    const matches =
      transponderId && transponderKind
        ? await this.entriesService.findByTransponder(
            transponderKind,
            transponderId,
          )
        : [];
    // A transponder moved off a withdrawn car is often still registered on it.
    const inEvent = matches.filter((e) => !isOutOfEvent(e.status));
    const entry =
      matches.length === 1
        ? matches[0]
        : inEvent.length === 1
          ? inEvent[0]
          : null;
    // On several cars it identifies none of them, so it's held like a beam
    // passing rather than timed for whichever car the database returns first.
    const shared = !entry && matches.length > 1;
    if (transponderId && matches.length === 0) {
      this.logger.warn(
        `Detection for unregistered ${transponderKind} transponder ${transponderId}`,
      );
    }
    if (shared) {
      this.logger.warn(
        `Transponder ${transponderId} is on ${matches.length} entries — holding the passing for a marshal`,
      );
    }
    // Only a passing at a live gate needs a marshal; one at an idle gate (setup,
    // someone walking through) has nothing to be timed against.
    const awaitingEntry =
      (!transponderId || shared) &&
      !!gate &&
      !!(await this.gateAssignmentsService.findActiveForGate(gate.id));

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
      transponderId: transponderId ?? null,
      transponderKind,
      entryId: entry?.id ?? null,
      awaitingEntry,
      timestampGate,
      timestampServer: new Date(),
      clockCorrectionMs,
      // As published, not as parsed: parsing keeps only the fields the rules
      // use, and evidence like the ESP32's `metadata.timeUnknown` would go.
      rawPayload,
      processed: false,
    });
    try {
      await this.events.insert(record);
    } catch (err) {
      // Two deliveries of one detection can both pass the check above when
      // they're handled concurrently; the primary key decides which one wins.
      if (await this.isDuplicate(detection.eventId)) {
        return;
      }
      throw err;
    }
    if (awaitingEntry) {
      await this.emitAwaitingChanged();
    }

    await this.applyRulesForRecord(record);
    // After the rules, not before: the payload carries `processed`, and
    // emitted earlier it is always false, so every live detection would read
    // as a rule failure.
    this.emitter.emit('detection.created', record);
  }

  /**
   * QoS 1 is at-least-once: a gate that never saw the PUBACK republishes a
   * detection the server already stored. The stored record must win — a
   * re-ingest would re-measure `clockCorrectionMs` and, for a passing a
   * marshal already assigned, clear `entryId` and list it as awaiting again.
   * `save()` would do exactly that, as it upserts on the primary key.
   */
  private async isDuplicate(eventId: string): Promise<boolean> {
    if (!(await this.events.existsBy({ eventId }))) {
      return false;
    }
    this.logger.debug(`Ignoring redelivered detection ${eventId}`);
    return true;
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
      // An unknown gate or unidentified entry is not a failure — there's
      // nothing to apply and retrying won't change that, so it's marked
      // processed to keep the pending list to real problems.
      if (gate && record.entryId) {
        await this.applyRules(gate, record.entryId, effectiveTime(record));
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

  /**
   * Returns whether this passing changed anything. The live path ignores it
   * (repeats are expected there); a marshal's assignment must not.
   */
  private async applyRules(
    gate: Gate,
    entryId: string,
    at: Date,
  ): Promise<boolean> {
    const assignment = await this.gateAssignmentsService.findActiveForGate(
      gate.id,
    );
    if (!assignment) {
      return false;
    }
    const stageId = assignment.stageId;

    // Out of the event: the passing is evidence (a protest may turn on it),
    // so it stays stored, but it times nothing for this car.
    const entry = await this.entriesService.findOne(entryId);
    if (entry && isOutOfEvent(entry.status)) {
      this.logger.warn(
        `#${entry.startNumber} is ${entry.status} — storing the passing at gate ${gate.id} without timing it`,
      );
      return false;
    }

    // `GateAssignment.active` and `Stage.status` are two records kept in step
    // by `StagesService` in separate steps, so a crash between them leaves a
    // gate live on a stage that isn't. Checking both means a detection in that
    // window is stored untimed rather than attached to a dormant stage.
    const stage = await this.stagesService.findOne(stageId);
    if (stage?.status !== StageStatus.ACTIVE) {
      this.logger.warn(
        `Gate ${gate.id} is assigned to stage ${stageId}, which is ${stage?.status ?? 'missing'} rather than ACTIVE — storing the detection without timing it`,
      );
      return false;
    }
    if (assignment.role === GateRole.STAGE_START) {
      const run = await this.stageRunsService.startRun(entryId, stageId, at);
      this.emitter.emit('stage-run.updated', run);
      // startRun hands back the existing run for a duplicate start.
      return run.startTime.getTime() === at.getTime();
    }
    if (assignment.role === GateRole.STAGE_FINISH) {
      const run = await this.stageRunsService.finishRun(entryId, stageId, at);
      if (run) {
        this.emitter.emit('stage-run.updated', run);
      }
      return !!run;
    }
    if (assignment.role === GateRole.STAGE_START_FINISH) {
      const run = await this.stageRunsService.startOrFinishRun(
        entryId,
        stageId,
        at,
        stage.minDurationMs ?? DEFAULT_MIN_STAGE_DURATION_MS,
      );
      if (run) {
        this.emitter.emit('stage-run.updated', run);
      }
      // A duplicate start hands back the existing run, unchanged.
      return (
        !!run &&
        (run.startTime.getTime() === at.getTime() ||
          run.finishTime?.getTime() === at.getTime())
      );
    }
    if (assignment.role === GateRole.STAGE_SPLIT) {
      const split = await this.stageRunsService.recordSplit(
        entryId,
        stageId,
        gate.id,
        assignment.splitIndex ?? 0,
        at,
      );
      if (split) {
        this.emitter.emit('stage-run.split', split);
      }
      return split?.timestamp.getTime() === at.getTime();
    }
    return false;
  }
}

function effectiveTime(record: DetectionEventRecord): Date {
  return new Date(record.timestampGate.getTime() + record.clockCorrectionMs);
}
