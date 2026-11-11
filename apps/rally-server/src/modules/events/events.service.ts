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
  ChangeAction,
  DEFAULT_MIN_STAGE_DURATION_MS,
  DETECTION_MAX_AGE_MS,
  DETECTION_TOPIC_PREFIX,
  DetectionEvent,
  GateRole,
  isOutOfEvent,
  isSlotStart,
  PRE_START_TRIGGER_MAX_AGE_MS,
  SLOT_PASSING_AFTER_MS,
  StageStatus,
  StartMode,
  TransponderKind,
} from '@rally-gate/shared';
import { In, IsNull, Not, Repository } from 'typeorm';
import { apiError } from '../../common/api-error';
import { recordChange } from '../changes/record-change';
import type { GateAssignment } from '../gates/gate-assignment.entity';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { Gate } from '../gates/gate.entity';
import { GatesService } from '../gates/gates.service';
import { EntriesService } from '../entries/entries.service';
import {
  StageRunsService,
  type StageRunWithStatus,
} from '../stage-runs/stage-runs.service';
import type { Stage } from '../stages/stage.entity';
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
 * How long a finish or split with no run to attach to stays pending. A start
 * gate that dropped off Wi-Fi replays its starts on reconnect, after the
 * finishes that depend on them; the retry sweep applies those once the start
 * is in. Measured on the server clock from arrival, not on the gate's.
 */
export const AWAIT_START_MS = 10 * 60_000;

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
    by: string | null,
  ): Promise<DetectionEventRecord> {
    const record = await this.findAwaitingOrThrow(eventId);
    const stageId = await this.stageIdOfAwaiting(eventId);
    if (!(await this.entriesService.findOne(entryId))) {
      throw new NotFoundException(
        apiError(ApiErrorCode.ENTRY_NOT_FOUND, `Entry ${entryId} not found`),
      );
    }
    const gate = await this.gatesService.findOne(record.gateId);
    const applied =
      gate &&
      (await this.applyRules(gate, entryId, effectiveTime(record), { by }));
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
    // The run the rules just wrote is the consequence; this records the
    // decision behind it.
    await this.events.manager.transaction(async (manager) => {
      await manager.save(DetectionEventRecord, record);
      await recordChange(manager, by, {
        action: ChangeAction.PASSING_ASSIGNED,
        entryId,
        stageId,
        subjectId: record.eventId,
        after: passingSnapshot(record),
      });
    });
    await this.emitAwaitingChanged();
    return record;
  }

  /**
   * A closed stage's unassigned passings can no longer be timed (assign 409s
   * on a closed stage), and once a gate is reused by another stage they'd be
   * read as that stage's. So they leave the list; the records stay as
   * evidence. Live timing's close confirmation says how many.
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

  /**
   * Who is waiting at the start of a stage (`docs/event-model.md` "Pre-start
   * gate"): a pre-start detection received after the end of the car's last
   * run on any stage, so a detection for the stage before at the same gate doesn't
   * count, and until its next run starts. Server receive time, since a
   * detection may carry `timeUnknown`.
   */
  async entriesAtStart(stageId: string): Promise<string[]> {
    const gateIds = (await this.gateAssignmentsService.findByStage(stageId))
      .filter((a) => a.role === GateRole.STAGE_PRE_START)
      .map((a) => a.gateId);
    if (gateIds.length === 0) return [];
    const seenAt = new Map<string, number>();
    for (const { entryId, timestampServer } of await this.events.find({
      where: { gateId: In(gateIds), entryId: Not(IsNull()) },
    })) {
      const at = timestampServer.getTime();
      seenAt.set(entryId!, Math.max(seenAt.get(entryId!) ?? 0, at));
    }
    if (seenAt.size === 0) return [];
    const lastRunEnd = new Map<string, number>();
    const now = Date.now();
    const timetable =
      (await this.stagesService.findOne(stageId))?.startMode ===
      StartMode.SLOT_SCHEDULE;
    for (const run of await this.stageRunsService.findByEntries([
      ...seenAt.keys(),
    ])) {
      // A timetable slot still ahead whose car hasn't left is no run yet:
      // every car has one long before it is due. A manual countdown's slot
      // does end it: the card shows that car by its slot instead.
      if (
        timetable &&
        run.stageId === stageId &&
        run.plannedStartTime &&
        !run.startPassingAt &&
        !run.finishTime &&
        run.plannedStartTime.getTime() > now
      ) {
        continue;
      }
      const end = (run.finishTime ?? run.startTime).getTime();
      lastRunEnd.set(
        run.entryId,
        Math.max(lastRunEnd.get(run.entryId) ?? 0, end),
      );
    }
    return [...seenAt]
      .filter(([entryId, at]) => at > (lastRunEnd.get(entryId) ?? 0))
      .map(([entryId]) => entryId);
  }

  /** For a passing that was no car at all: a marshal, a dog, a double trigger. */
  async dismissAwaiting(
    eventId: string,
    by: string | null,
  ): Promise<DetectionEventRecord> {
    const record = await this.findAwaitingOrThrow(eventId);
    const stageId = await this.stageIdOfAwaiting(eventId);
    record.awaitingEntry = false;
    await this.events.manager.transaction(async (manager) => {
      await manager.save(DetectionEventRecord, record);
      await recordChange(manager, by, {
        action: ChangeAction.PASSING_DISMISSED,
        entryId: null,
        stageId,
        subjectId: record.eventId,
        before: passingSnapshot(record),
      });
    });
    await this.emitAwaitingChanged();
    return record;
  }

  /**
   * The stage a waiting passing would time, for the stage marshal check:
   * its gate's active assignment, null when there is none.
   */
  async stageIdOfAwaiting(eventId: string): Promise<string | null> {
    const record = await this.findAwaitingOrThrow(eventId);
    const assignment = await this.gateAssignmentsService.findActiveForGate(
      record.gateId,
    );
    return assignment?.stageId ?? null;
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
   * about a failure the moment it happens instead of asking on a timer.
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

  /**
   * The broker awaits this before it PUBACKs (`BrokerService`), so it must
   * throw when the detection isn't stored: the gate then keeps it and
   * publishes it again. Hence `suppressErrors: false`.
   */
  @OnEvent('mqtt.message', { suppressErrors: false })
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
    // The broker checks the topic against the gate's login, not the payload.
    if (detection && detection.gateId !== match[1]) {
      this.logger.warn(
        `Ignoring detection for gate ${detection.gateId} published on ${topic}`,
      );
      return;
    }
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
    // Gate clocks are independent of each other and of the server's, so a
    // duration built from two gates' raw timestamps carries their
    // disagreement. Correct onto server time here, at ingest, and keep both
    // halves — see "Clock offset" in docs/architecture.md.
    // Also before judging age, so a gate whose clock is behind loses nothing.
    const clockCorrectionMs = gate
      ? this.gatesService.clockCorrectionMsFor(gate)
      : 0;
    const timestampGate = new Date(detection.timestampGate);
    const effectiveMs = timestampGate.getTime() + clockCorrectionMs;
    if (
      !isTimeUnknown(rawPayload) &&
      Date.now() - effectiveMs > DETECTION_MAX_AGE_MS
    ) {
      // Returning acknowledges it, so the gate drops it from its buffer.
      this.logger.warn(
        `Ignoring detection ${detection.eventId} from gate ${detection.gateId} at ${new Date(effectiveMs).toISOString()}: older than 24 h, from a previous event`,
      );
      return;
    }
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
    const assignment = gate
      ? await this.gateAssignmentsService.findActiveForGate(gate.id)
      : null;

    const unidentified = !transponderId || shared;
    // The one automatic assignment: a start passing on a slot stage sets no
    // time, only the jump-start mark a marshal confirms.
    const slotRun =
      unidentified && assignment
        ? await this.slotRunNear(
            assignment,
            new Date(timestampGate.getTime() + clockCorrectionMs),
          )
        : null;
    // Only a passing at a live gate needs a marshal; one at an idle gate (setup,
    // someone walking through) has nothing to be timed against.
    const awaitingEntry = unidentified && !!assignment && !slotRun;

    const record = this.events.create({
      eventId: detection.eventId,
      gateId: detection.gateId,
      transponderId: transponderId ?? null,
      transponderKind,
      entryId: entry?.id ?? slotRun?.entryId ?? null,
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
        const applied = await this.applyRules(
          gate,
          record.entryId,
          effectiveTime(record),
          undefined,
          isStaleDetection(record),
        );
        if (
          applied === null &&
          Date.now() - record.timestampServer.getTime() < AWAIT_START_MS
        ) {
          this.logger.warn(
            `Detection ${record.eventId} from gate ${record.gateId} has no run to finish or split yet; keeping it pending until its start arrives`,
          );
          await this.emitPendingChanged();
          return false;
        }
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
   * (repeats are expected there); a marshal's assignment must not. Null (also
   * falsy) is a finish or split for an entry with no run on the stage at all:
   * its start may still be on its way. `assigned` is a marshal's assignment
   * of an unidentified passing, absent for a gate's own detection; `stale`
   * a gate's detection too old to start a countdown.
   */
  private async applyRules(
    gate: Gate,
    entryId: string,
    at: Date,
    assigned?: { by: string | null },
    stale = false,
  ): Promise<boolean | null> {
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
    if (isSlotStart(stage.startMode)) {
      const slotRole = await this.applySlotRules(
        stage,
        assignment,
        entryId,
        at,
      );
      if (slotRole !== undefined) {
        return slotRole;
      }
    }
    if (assignment.role === GateRole.STAGE_PRE_START) {
      // Elsewhere the detection itself is the "at the start" state. The slot
      // is from now, never `at`: for an assigned beam passing the assignment
      // is the trigger, so a late one never makes a slot in the past.
      if (stage.startMode !== StartMode.SLOT_MANUAL) return true;
      if (assigned) {
        // A marshal hears that the car is already starting: 409.
        await this.stageRunsService.startCountdown(
          entryId,
          stageId,
          assigned.by,
        );
        return true;
      }
      if (stale) {
        this.logger.warn(
          `Pre-start detection for entry ${entryId} at gate ${gate.id} is older than ${PRE_START_TRIGGER_MAX_AGE_MS} ms, marking it at the start without a countdown`,
        );
        return false;
      }
      return !!(await this.stageRunsService.triggerCountdown(entryId, stageId));
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
        return true;
      }
      return this.awaitsStart(entryId, stageId);
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
        return split.timestamp.getTime() === at.getTime();
      }
      return this.awaitsStart(entryId, stageId);
    }
    return false;
  }

  /**
   * A slot stage's start and combined gates (`docs/event-model.md` "Start
   * slots"): a passing there never opens a run, the slot did. Undefined for
   * the roles that work as on any stage.
   */
  private async applySlotRules(
    stage: Stage,
    assignment: GateAssignment,
    entryId: string,
    at: Date,
  ): Promise<boolean | undefined> {
    let run: StageRunWithStatus | null;
    if (assignment.role === GateRole.STAGE_START) {
      run = await this.stageRunsService.recordStartPassing(
        entryId,
        stage.id,
        at,
      );
    } else if (assignment.role === GateRole.STAGE_START_FINISH) {
      run = await this.stageRunsService.slotStartOrFinish(
        entryId,
        stage.id,
        at,
        stage.minDurationMs ?? DEFAULT_MIN_STAGE_DURATION_MS,
      );
    } else {
      return undefined;
    }
    if (!run) {
      return false;
    }
    this.emitter.emit('stage-run.updated', run);
    return [run.startTime, run.finishTime, run.startPassingAt].some(
      (time) => time?.getTime() === at.getTime(),
    );
  }

  /** The slot an unidentified start passing belongs to, if any. */
  private async slotRunNear(assignment: GateAssignment, at: Date) {
    const stage = await this.stagesService.findOne(assignment.stageId);
    if (stage?.status !== StageStatus.ACTIVE || !isSlotStart(stage.startMode)) {
      return null;
    }
    if (assignment.role === GateRole.STAGE_START) {
      return this.stageRunsService.findSlotNear(
        stage.id,
        at,
        SLOT_PASSING_AFTER_MS,
      );
    }
    if (assignment.role === GateRole.STAGE_START_FINISH) {
      // Later than slot + minDurationMs it is some car's finish.
      return this.stageRunsService.findSlotNear(
        stage.id,
        at,
        Math.min(
          SLOT_PASSING_AFTER_MS,
          stage.minDurationMs ?? DEFAULT_MIN_STAGE_DURATION_MS,
        ),
      );
    }
    return null;
  }

  /** Null when the entry has no run here, so the passing may wait for one. */
  private async awaitsStart(
    entryId: string,
    stageId: string,
  ): Promise<false | null> {
    return (await this.stageRunsService.hasRun(entryId, stageId))
      ? false
      : null;
  }
}

const passingSnapshot = (record: DetectionEventRecord) => ({
  gateId: record.gateId,
  time: effectiveTime(record).toISOString(),
});

/**
 * Judged against now, not the receive time: the slot is from now, so a
 * detection retried by the sweep is as late as one replayed by its gate. One
 * with `metadata.timeUnknown` has no age to judge and is never stale.
 */
function isStaleDetection(record: DetectionEventRecord): boolean {
  return (
    !isTimeUnknown(record.rawPayload) &&
    Date.now() - effectiveTime(record).getTime() > PRE_START_TRIGGER_MAX_AGE_MS
  );
}

/** The ESP32 gate's flag for a passing timed after it lost the time of day. */
function isTimeUnknown(rawPayload: string): boolean {
  try {
    const { metadata } = JSON.parse(rawPayload) as {
      metadata?: { timeUnknown?: unknown };
    };
    return metadata?.timeUnknown === true;
  } catch {
    // Stored only once parsed, so this is a hand-made record.
    return false;
  }
}

function effectiveTime(record: DetectionEventRecord): Date {
  return new Date(record.timestampGate.getTime() + record.clockCorrectionMs);
}
