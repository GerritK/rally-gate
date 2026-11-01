import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import {
  ChangeAction,
  DEFAULT_COUNTDOWN_MS,
  DEFAULT_MIN_START_GAP_MS,
  EntryStatus,
  GateRole,
  PRE_START_TRIGGER_MAX_AGE_MS,
  StageRunStatus,
  StageScoring,
  StageStatus,
  StartMode,
  TransponderKind,
} from '@rally-gate/shared';
import { DataSource } from 'typeorm';
import { ChangeRecord } from '../changes/change-record.entity';
import { StageRun } from '../stage-runs/stage-run.entity';
import { StageSplit } from '../stage-runs/stage-split.entity';
import {
  deriveStageRunStatus,
  StageRunsService,
} from '../stage-runs/stage-runs.service';
import { DetectionEventRecord } from './detection-event.entity';
import { EventsService } from './events.service';

/**
 * Every start path end to end, detection in, run out, against real sqlite:
 * the slot queries (nearest slot, the conditional earliest-passing update)
 * are exactly what a mocked repository can't check.
 */
const ENTRIES = [
  { id: 'v1', startNumber: 1, status: 'CHECKED_IN', transponder: '111' },
  { id: 'v2', startNumber: 2, status: 'CHECKED_IN', transponder: '222' },
];

describe('start paths', () => {
  let dataSource: DataSource;
  let stage: {
    id: string;
    status: StageStatus;
    startMode: StartMode;
    scoring: StageScoring;
    minDurationMs: number | null;
    firstStartTime: Date | null;
    slotIntervalMs: number | null;
    startOrder: string[] | null;
  };
  let roles: Record<string, GateRole>;
  let runs: StageRunsService;
  let events: EventsService;
  let emitter: { emit: jest.Mock };
  let stageChanged: jest.Mock;
  let seq = 0;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [StageRun, StageSplit, DetectionEventRecord, ChangeRecord],
      synchronize: true,
    });
    await dataSource.initialize();
    stage = {
      id: 'SS1',
      status: StageStatus.ACTIVE,
      startMode: StartMode.SLOT_MANUAL,
      scoring: StageScoring.OVERALL,
      minDurationMs: null,
      firstStartTime: null,
      slotIntervalMs: null,
      startOrder: null,
    };
    roles = {
      START: GateRole.STAGE_START,
      FINISH: GateRole.STAGE_FINISH,
      SPLIT: GateRole.STAGE_SPLIT,
      LOOP: GateRole.STAGE_START_FINISH,
      PRE: GateRole.STAGE_PRE_START,
    };
    emitter = { emit: jest.fn() };
    const stagesService = {
      findOne: () => Promise.resolve(stage),
      findOneOrFail: () => Promise.resolve(stage),
      findAll: () => Promise.resolve([stage]),
      setFirstStartTime: (_id: string, at: Date) => {
        stage.firstStartTime = at;
        return Promise.resolve();
      },
      changed: (stageChanged = jest.fn()),
    };
    const settings = {
      getNumber: (_key: string, fallback: number) => Promise.resolve(fallback),
    };
    runs = new StageRunsService(
      dataSource.getRepository(StageRun),
      dataSource.getRepository(StageSplit),
      stagesService as never,
      emitter as never,
      settings as never,
    );
    events = new EventsService(
      dataSource.getRepository(DetectionEventRecord),
      {
        findOne: (id: string) =>
          Promise.resolve(roles[id] ? { id, name: id } : null),
        clockCorrectionMsFor: () => Promise.resolve(0),
      } as never,
      {
        findActiveForGate: (id: string) =>
          Promise.resolve(
            roles[id]
              ? { gateId: id, stageId: 'SS1', role: roles[id], splitIndex: 1 }
              : null,
          ),
        findByStage: () =>
          Promise.resolve(
            Object.entries(roles).map(([gateId, role]) => ({ gateId, role })),
          ),
      } as never,
      {
        findByTransponder: (_kind: TransponderKind, id: string) =>
          Promise.resolve(ENTRIES.filter((e) => e.transponder === id)),
        findOne: (id: string) =>
          Promise.resolve(ENTRIES.find((e) => e.id === id) ?? null),
      } as never,
      runs,
      stagesService as never,
      emitter as never,
    );
  });

  afterEach(() => dataSource.destroy());

  /** A passing at `gateId`, `offsetMs` from `base`; no transponder is a beam. */
  async function pass(
    gateId: string,
    base: Date,
    offsetMs: number,
    transponderId?: string,
    eventId = `e${++seq}`,
    metadata?: Record<string, unknown>,
  ): Promise<DetectionEventRecord> {
    await events.handleMqttMessage({
      topic: `rally/gates/${gateId}/detections`,
      payload: Buffer.from(
        JSON.stringify({
          eventId,
          gateId,
          transponderId,
          timestampGate: new Date(base.getTime() + offsetMs).toISOString(),
          source: 'test',
          metadata,
        }),
      ),
    });
    return dataSource
      .getRepository(DetectionEventRecord)
      .findOneByOrFail({ eventId });
  }

  const allRuns = () =>
    dataSource.getRepository(StageRun).find({ order: { attempt: 'ASC' } });

  describe('gate start', () => {
    beforeEach(() => {
      stage.startMode = StartMode.GATE;
    });

    it('starts at the start passing and finishes at the finish', async () => {
      const t0 = new Date('2026-11-01T10:00:00.000Z');
      await pass('START', t0, 0, '111');
      await pass('FINISH', t0, 90_123, '111');

      const [run] = await allRuns();
      expect(run.startTime).toEqual(t0);
      expect(run.plannedStartTime).toBeNull();
      expect(run.durationMs).toBe(90_123);
    });

    it('refuses a countdown', async () => {
      await expect(runs.startCountdown('v1', 'SS1', null)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('manual slots', () => {
    it('times from the slot, not the start passing', async () => {
      const before = Date.now();
      const queued = await runs.startCountdown('v1', 'SS1', 'device-1');
      const slot = queued.plannedStartTime!;

      expect(slot.getTime()).toBeGreaterThanOrEqual(
        before + DEFAULT_COUNTDOWN_MS,
      );
      expect(queued.startTime).toEqual(slot);

      // Stalled, left 20 s late: the clock ran from the slot anyway.
      await pass('START', slot, 20_000, '111');
      await pass('FINISH', slot, 95_000, '111');

      const [run] = await allRuns();
      expect(run.durationMs).toBe(95_000);
      expect(run.startPassingAt).toEqual(new Date(slot.getTime() + 20_000));
    });

    it('records who started the countdown', async () => {
      const queued = await runs.startCountdown('v1', 'SS1', 'device-1');
      const [change] = await dataSource.getRepository(ChangeRecord).find();
      expect(change).toMatchObject({
        action: ChangeAction.COUNTDOWN_STARTED,
        deviceId: 'device-1',
        subjectId: queued.id,
      });
    });

    it('times a car the start gate missed from its slot', async () => {
      const { plannedStartTime: slot } = await runs.startCountdown(
        'v1',
        'SS1',
        null,
      );
      await pass('FINISH', slot!, 80_000, '111');

      const [run] = await allRuns();
      expect(run.startPassingAt).toBeNull();
      expect(run.durationMs).toBe(80_000);
    });

    it('ignores a finish before the slot, so no duration is zero or negative', async () => {
      const { plannedStartTime: slot } = await runs.startCountdown(
        'v1',
        'SS1',
        null,
      );
      await pass('FINISH', slot!, -1_000, '111');
      await pass('FINISH', slot!, 0, '111');

      const [run] = await allRuns();
      expect(run.finishTime).toBeNull();
    });

    it('ignores a split before the slot', async () => {
      const { plannedStartTime: slot } = await runs.startCountdown(
        'v1',
        'SS1',
        null,
      );
      await pass('SPLIT', slot!, -500, '111');

      expect(await dataSource.getRepository(StageSplit).count()).toBe(0);
    });

    it('queues the next slot at least the minimum gap after the last', async () => {
      const first = await runs.startCountdown('v1', 'SS1', null);
      const second = await runs.startCountdown('v2', 'SS1', null);

      expect(
        second.plannedStartTime!.getTime() - first.plannedStartTime!.getTime(),
      ).toBe(DEFAULT_MIN_START_GAP_MS);
    });

    it('gives two countdowns at once two different slots', async () => {
      const [a, b] = await Promise.all([
        runs.startCountdown('v1', 'SS1', null),
        runs.startCountdown('v2', 'SS1', null),
      ]);
      expect(
        Math.abs(a.plannedStartTime!.getTime() - b.plannedStartTime!.getTime()),
      ).toBe(DEFAULT_MIN_START_GAP_MS);
    });

    it('refuses a countdown for a car already queued', async () => {
      await runs.startCountdown('v1', 'SS1', null);
      await expect(runs.startCountdown('v1', 'SS1', null)).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses a countdown on a stage that is not active', async () => {
      stage.status = StageStatus.NOT_STARTED;
      await expect(runs.startCountdown('v1', 'SS1', null)).rejects.toThrow(
        ConflictException,
      );
    });

    it('never opens a run from a start passing', async () => {
      await pass('START', new Date(), 0, '111');
      expect(await allRuns()).toHaveLength(0);
    });
  });

  describe('jump start', () => {
    it('keeps the earliest start passing, so a repeat changes nothing', async () => {
      const { plannedStartTime: slot } = await runs.startCountdown(
        'v1',
        'SS1',
        null,
      );
      const late = await pass('START', slot!, 300, '111');
      const early = await pass('START', slot!, -400, '111');
      const again = await pass('START', slot!, 1_000, '111');

      const [run] = await allRuns();
      expect(run.startPassingAt).toEqual(new Date(slot!.getTime() - 400));
      expect(run.startTime).toEqual(slot);
      for (const record of [late, early, again]) {
        expect(record.processed).toBe(true);
      }
    });

    it('may be dismissed only when it is one, and records it', async () => {
      const queued = await runs.startCountdown('v1', 'SS1', null);
      await pass('START', queued.plannedStartTime!, -100, '111');
      // Within the 200 ms tolerance: no jump start.
      await expect(runs.dismissJumpStart(queued.id, null)).rejects.toThrow(
        ConflictException,
      );

      await pass('START', queued.plannedStartTime!, -500, '111');
      const dismissed = await runs.dismissJumpStart(queued.id, 'device-1');
      expect(dismissed.jumpStartDismissed).toBe(true);
      expect(
        await dataSource
          .getRepository(ChangeRecord)
          .findOneBy({ action: ChangeAction.JUMP_START_DISMISSED }),
      ).not.toBeNull();
    });

    it('leaves a transponder passing far from its slot untimed', async () => {
      const { plannedStartTime: slot } = await runs.startCountdown(
        'v1',
        'SS1',
        null,
      );
      const record = await pass('START', slot!, -11_000, '111');

      expect((await allRuns())[0].startPassingAt).toBeNull();
      expect(record.processed).toBe(true);
    });
  });

  describe('light barrier at a slot stage start', () => {
    const passingOf = async (entryId: string) =>
      (await allRuns()).find((r) => r.entryId === entryId)!.startPassingAt;

    it('gives a stalled car its own late passing, not the next car a jump start', async () => {
      const first = await runs.startCountdown('v1', 'SS1', null);
      await runs.startCountdown('v2', 'SS1', null);

      // v1 leaves 25 s late, 5 s before v2's slot.
      const record = await pass('START', first.plannedStartTime!, 25_000);

      expect(record.entryId).toBe('v1');
      expect(await passingOf('v2')).toBeNull();
    });

    it('gives a passing after a no-show to the latest begun slot', async () => {
      await runs.startCountdown('v1', 'SS1', null);
      const second = await runs.startCountdown('v2', 'SS1', null);

      // v1 never came; v2 leaves on time.
      const record = await pass('START', second.plannedStartTime!, 300);

      expect(record.entryId).toBe('v2');
      expect(await passingOf('v1')).toBeNull();
    });

    it('falls back to the nearest slot, so a jump start is still caught', async () => {
      const first = await runs.startCountdown('v1', 'SS1', null);
      const second = await runs.startCountdown('v2', 'SS1', null);
      await pass('START', first.plannedStartTime!, 100, '111');

      const record = await pass('START', second.plannedStartTime!, -2_000);

      expect(record.entryId).toBe('v2');
      expect(await passingOf('v2')).toEqual(
        new Date(second.plannedStartTime!.getTime() - 2_000),
      );
    });

    it('leaves a beam passing outside every window for a marshal', async () => {
      const { plannedStartTime: slot } = await runs.startCountdown(
        'v1',
        'SS1',
        null,
      );
      const record = await pass('START', slot!, 61_000);

      expect(record.entryId).toBeNull();
      expect(record.awaitingEntry).toBe(true);
    });
  });

  describe('combined start/finish gate on a slot stage', () => {
    it('reads passings before slot + minimum as the start, the next as the finish', async () => {
      const { plannedStartTime: slot } = await runs.startCountdown(
        'v1',
        'SS1',
        null,
      );
      await pass('LOOP', slot!, -300, '111');
      await pass('LOOP', slot!, 4_000, '111');
      await pass('LOOP', slot!, 70_000, '111');

      const [run] = await allRuns();
      expect(run.startPassingAt).toEqual(new Date(slot!.getTime() - 300));
      expect(run.durationMs).toBe(70_000);
    });

    it('assigns a beam start passing, but not one after the minimum', async () => {
      const { plannedStartTime: slot } = await runs.startCountdown(
        'v1',
        'SS1',
        null,
      );
      const start = await pass('LOOP', slot!, 500);
      const later = await pass('LOOP', slot!, 30_000);

      expect(start.entryId).toBe('v1');
      expect(later.awaitingEntry).toBe(true);
    });
  });

  describe('re-run after a void', () => {
    it('refuses a countdown for a finished car until its run is voided', async () => {
      const first = await runs.startCountdown('v1', 'SS1', null);
      await pass('FINISH', first.plannedStartTime!, 60_000, '111');
      await expect(runs.startCountdown('v1', 'SS1', null)).rejects.toThrow(
        ConflictException,
      );

      await runs.voidRun(first.id, null);
      const rerun = await runs.startCountdown('v1', 'SS1', null);
      expect(rerun.attempt).toBe(2);
      await pass('START', rerun.plannedStartTime!, -1_000, '111');

      const [voided, counting] = await allRuns();
      expect(voided.startPassingAt).toBeNull();
      expect(counting.startPassingAt).not.toBeNull();
    });
  });

  describe('shakedown', () => {
    beforeEach(() => {
      stage.scoring = StageScoring.NONE;
    });

    it('makes every countdown the next run of the car', async () => {
      const first = await runs.startCountdown('v1', 'SS1', null);
      await pass('FINISH', first.plannedStartTime!, 60_000, '111');
      const second = await runs.startCountdown('v1', 'SS1', null);

      expect(second).toMatchObject({ attempt: 2, run: 2 });
    });

    it('still refuses one while the car is on stage', async () => {
      await runs.startCountdown('v1', 'SS1', null);
      await expect(runs.startCountdown('v1', 'SS1', null)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('cancel', () => {
    it('deletes the slot, records it and tells the screens', async () => {
      const queued = await runs.startCountdown('v1', 'SS1', null);
      await runs.cancelCountdown(queued.id, 'device-1');

      expect(await allRuns()).toHaveLength(0);
      expect(
        await dataSource
          .getRepository(ChangeRecord)
          .findOneBy({ action: ChangeAction.COUNTDOWN_CANCELLED }),
      ).toMatchObject({ deviceId: 'device-1', subjectId: queued.id });
      expect(emitter.emit).toHaveBeenCalledWith('stage-run.deleted', {
        id: queued.id,
        stageId: 'SS1',
      });
    });

    it('refuses once the car passed the start', async () => {
      const queued = await runs.startCountdown('v1', 'SS1', null);
      await pass('START', queued.plannedStartTime!, 100, '111');
      await expect(runs.cancelCountdown(queued.id, null)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('pre-start gate', () => {
    /** A tap now, as a gate with a synced clock sends it. */
    const tap = (transponderId: string, eventId?: string) =>
      pass('PRE', new Date(), 0, transponderId, eventId);

    it('triggers the countdown from the server receive time', async () => {
      const before = Date.now();
      await tap('111');

      const [run] = await allRuns();
      expect(run.plannedStartTime!.getTime()).toBeGreaterThanOrEqual(
        before + DEFAULT_COUNTDOWN_MS,
      );
      expect(run.plannedStartTime!.getTime()).toBeLessThanOrEqual(
        Date.now() + DEFAULT_COUNTDOWN_MS,
      );
      const [change] = await dataSource.getRepository(ChangeRecord).find();
      expect(change).toMatchObject({
        action: ChangeAction.COUNTDOWN_STARTED,
        deviceId: null,
      });
    });

    it('only marks a car at the start for a tap replayed late, starting no countdown', async () => {
      stage.startMode = StartMode.SLOT_MANUAL;
      const late = await pass(
        'PRE',
        new Date(),
        -(PRE_START_TRIGGER_MAX_AGE_MS + 1_000),
        '111',
      );
      expect(late.processed).toBe(true);
      expect(await allRuns()).toHaveLength(0);
      expect(await events.entriesAtStart('SS1')).toEqual(['v1']);
    });

    it('triggers for a tap whose gate clock is unknown, whatever its timestamp says', async () => {
      await pass(
        'PRE',
        new Date('2000-01-01T00:00:00.000Z'),
        0,
        '111',
        undefined,
        {
          timeUnknown: true,
        },
      );
      expect(await allRuns()).toHaveLength(1);
    });

    it('queues taps like the button, in tap order', async () => {
      await tap('222');
      await tap('111');

      const [first, second] = await allRuns();
      expect(first.entryId).toBe('v2');
      expect(
        second.plannedStartTime!.getTime() - first.plannedStartTime!.getTime(),
      ).toBe(DEFAULT_MIN_START_GAP_MS);
    });

    it('stores and ignores a tap for a car already queued or on stage', async () => {
      await tap('111');
      const again = await tap('111');
      expect(again.processed).toBe(true);
      expect(await allRuns()).toHaveLength(1);

      const [run] = await allRuns();
      await pass('START', run.plannedStartTime!, 0, '111');
      await tap('111');
      expect(await allRuns()).toHaveLength(1);
    });

    it('ignores a tap for a car that finished a counted stage', async () => {
      await tap('111');
      const [run] = await allRuns();
      await pass('FINISH', run.plannedStartTime!, 60_000, '111');
      await tap('111');
      expect(await allRuns()).toHaveLength(1);
    });

    it('makes one slot of a replayed detection', async () => {
      await tap('111', 'replayed');
      await tap('111', 'replayed');
      expect(await allRuns()).toHaveLength(1);
    });

    it('makes every tap on a shakedown the next run', async () => {
      stage.scoring = StageScoring.NONE;
      await tap('111');
      const [first] = await allRuns();
      await pass('FINISH', first.plannedStartTime!, 60_000, '111');
      await tap('111');

      expect((await allRuns()).map((r) => r.run)).toEqual([1, 2]);
    });

    it('takes a beam passing as the trigger once a marshal assigns it', async () => {
      const beam = await pass('PRE', new Date(Date.now() - 600_000), 0);
      expect(beam.awaitingEntry).toBe(true);
      expect(await allRuns()).toHaveLength(0);

      const before = Date.now();
      await events.assignEntry(beam.eventId, 'v1', 'device-1');
      const [run] = await allRuns();
      expect(run.plannedStartTime!.getTime()).toBeGreaterThanOrEqual(
        before + DEFAULT_COUNTDOWN_MS,
      );
      const [change] = await dataSource
        .getRepository(ChangeRecord)
        .findBy({ action: ChangeAction.COUNTDOWN_STARTED });
      expect(change.deviceId).toBe('device-1');
    });

    it('refuses to assign a beam passing to a car already queued, leaving it listed', async () => {
      await tap('111');
      const beam = await pass('PRE', new Date(), 0);

      await expect(
        events.assignEntry(beam.eventId, 'v1', null),
      ).rejects.toThrow(ConflictException);
      const stored = await dataSource
        .getRepository(DetectionEventRecord)
        .findOneByOrFail({ eventId: beam.eventId });
      expect(stored.awaitingEntry).toBe(true);
    });

    it('triggers nothing on a gate-start stage', async () => {
      stage.startMode = StartMode.GATE;
      await tap('111');
      expect(await allRuns()).toHaveLength(0);
    });
  });

  describe('at the start', () => {
    beforeEach(() => {
      stage.startMode = StartMode.GATE;
    });

    it('marks a car from its pre-start detection until it starts', async () => {
      expect(await events.entriesAtStart('SS1')).toEqual([]);
      await pass('PRE', new Date(), 0, '111');
      expect(await events.entriesAtStart('SS1')).toEqual(['v1']);

      await pass('START', new Date(), 1_000, '111');
      expect(await events.entriesAtStart('SS1')).toEqual([]);
    });

    it('counts an assigned beam passing', async () => {
      const beam = await pass('PRE', new Date(), 0);
      expect(await events.entriesAtStart('SS1')).toEqual([]);
      await events.assignEntry(beam.eventId, 'v2', null);
      expect(await events.entriesAtStart('SS1')).toEqual(['v2']);
    });

    it('ignores a detection from before the end of the last run on any stage', async () => {
      await pass('PRE', new Date(), 0, '111');
      // The same gate, reused: the tap was for the stage before.
      await dataSource.getRepository(StageRun).save({
        entryId: 'v1',
        stageId: 'SS0',
        attempt: 1,
        run: 1,
        startTime: new Date(Date.now() + 1_000),
        finishTime: new Date(Date.now() + 60_000),
      });
      expect(await events.entriesAtStart('SS1')).toEqual([]);
    });

    it('is nobody on a stage without a pre-start gate', async () => {
      await pass('PRE', new Date(), 0, '111');
      delete roles.PRE;
      expect(await events.entriesAtStart('SS1')).toEqual([]);
    });

    it('shows a car counting down by its slot, not at the start', async () => {
      stage.startMode = StartMode.SLOT_MANUAL;
      await pass('PRE', new Date(), 0, '111');
      expect(await events.entriesAtStart('SS1')).toEqual([]);
    });
  });

  describe('timetable', () => {
    const MIN = 60_000;
    let first: Date;
    const at = (ms: number) => new Date(first.getTime() + ms);

    /** Activated with v1 and v2 one interval apart, a withdrawn car's gap after them. */
    beforeEach(async () => {
      first = new Date(Date.now() + 10 * MIN);
      Object.assign(stage, {
        startMode: StartMode.SLOT_SCHEDULE,
        firstStartTime: first,
        slotIntervalMs: MIN,
        startOrder: ['v1', 'v2', 'gone'],
      });
      await runs.createTimetableRuns('SS1', [
        { entryId: 'v1', slot: at(0) },
        { entryId: 'v2', slot: at(MIN) },
      ]);
    });

    const runOf = async (entryId: string) =>
      (await allRuns()).find((r) => r.entryId === entryId && !r.voided)!;
    const changes = () => dataSource.getRepository(ChangeRecord).find();

    it('creates one slot run per car, and none twice', async () => {
      await runs.createTimetableRuns('SS1', [{ entryId: 'v1', slot: at(0) }]);
      const all = await allRuns();
      expect(all).toHaveLength(2);
      expect((await runOf('v2')).startTime).toEqual(at(MIN));
      expect((await runOf('v2')).plannedStartTime).toEqual(at(MIN));
    });

    it('times a car from its slot, the start passing only marks', async () => {
      await pass('START', first, -2_000, '111');
      await pass('FINISH', first, 95_000, '111');
      const run = await runOf('v1');
      expect(run.durationMs).toBe(95_000);
      expect(run.startPassingAt).toEqual(at(-2_000));
    });

    it('never finishes before the slot', async () => {
      await pass('FINISH', first, 0, '111');
      expect((await runOf('v1')).finishTime).toBeNull();
    });

    it('gives New slot after the last slot, past a withdrawn car at the end', async () => {
      const moved = await runs.newSlot('v1', 'SS1', 'device-1');
      // Last posted slot is the withdrawn car's at 2 min: never into its gap.
      expect(moved.plannedStartTime).toEqual(at(3 * MIN));
      expect(moved.startTime).toEqual(at(3 * MIN));
      expect(await allRuns()).toHaveLength(2);
      const [change] = await changes();
      expect(change).toMatchObject({
        action: ChangeAction.SLOT_MOVED,
        entryId: 'v1',
        deviceId: 'device-1',
      });
      expect((await runs.newSlot('v2', 'SS1', null)).plannedStartTime).toEqual(
        at(4 * MIN),
      );
    });

    it('reports New slot moves and the Delays since the list was posted', async () => {
      const posted = new Date();
      await runs.delaySlots('SS1', MIN, null);
      await runs.newSlot('v2', 'SS1', null);
      await runs.delaySlots('SS1', 2 * MIN, null);
      const changed = await runs.slotChangesSince('SS1', posted);
      expect([...changed.movedEntryIds]).toEqual(['v2']);
      expect(changed.delayMs).toBe(3 * MIN);
      const later = await runs.slotChangesSince(
        'SS1',
        new Date(Date.now() + 1_000),
      );
      expect(later).toEqual({ movedEntryIds: new Set(), delayMs: 0 });
    });

    it('refuses New slot once the car has left on its slot', async () => {
      await pass('START', first, 300, '111');
      await expect(runs.newSlot('v1', 'SS1', null)).rejects.toMatchObject({
        response: { code: 'slotAlreadyLeft' },
      });
    });

    it('gives a voided car a new slot run, a finished one none', async () => {
      await pass('FINISH', first, 90_000, '111');
      await expect(runs.newSlot('v1', 'SS1', null)).rejects.toMatchObject({
        response: { code: 'entryAlreadyStarting' },
      });
      await runs.voidRun((await runOf('v1')).id, null);
      const rerun = await runs.newSlot('v1', 'SS1', null);
      expect(rerun.attempt).toBe(2);
      expect(rerun.plannedStartTime).toEqual(at(3 * MIN));
    });

    it('offers New slot and Delay only on a timetable stage', async () => {
      stage.startMode = StartMode.SLOT_MANUAL;
      await expect(runs.newSlot('v1', 'SS1', null)).rejects.toMatchObject({
        response: { code: 'notTimetableStart' },
      });
      await expect(runs.delaySlots('SS1', MIN, null)).rejects.toMatchObject({
        response: { code: 'notTimetableStart' },
      });
    });

    it('moves only the slots not yet reached on Delay, and the posted list with them', async () => {
      // v1's slot has passed without it; v2 is still ahead.
      const v1 = await runOf('v1');
      await dataSource.getRepository(StageRun).update(v1.id, {
        startTime: at(-11 * MIN),
        plannedStartTime: at(-11 * MIN),
      });
      await runs.delaySlots('SS1', 5 * MIN, 'device-1');

      expect((await runOf('v1')).plannedStartTime).toEqual(at(-11 * MIN));
      expect((await runOf('v2')).plannedStartTime).toEqual(at(6 * MIN));
      expect((await runOf('v2')).startTime).toEqual(at(6 * MIN));
      expect(stage.firstStartTime).toEqual(at(5 * MIN));
      const [change] = await changes();
      expect(change).toMatchObject({
        action: ChangeAction.SLOTS_DELAYED,
        entryId: null,
        stageId: 'SS1',
        after: { delayMs: 5 * MIN },
      });
    });

    it('leaves a car that already left out of a Delay', async () => {
      await pass('START', first, -3_000, '111');
      await runs.delaySlots('SS1', MIN, null);
      expect((await runOf('v1')).plannedStartTime).toEqual(at(0));
      expect((await runOf('v2')).plannedStartTime).toEqual(at(2 * MIN));
    });

    it('moves the first start alone on a Delay before activation', async () => {
      stage.status = StageStatus.NOT_STARTED;
      await runs.delaySlots('SS1', 2 * MIN, null);
      expect(stage.firstStartTime).toEqual(at(2 * MIN));
      expect((await runOf('v2')).plannedStartTime).toEqual(at(MIN));
    });

    it('refuses a Delay on a closed stage', async () => {
      stage.status = StageStatus.CLOSED;
      await expect(runs.delaySlots('SS1', MIN, null)).rejects.toThrow(
        ConflictException,
      );
    });

    it('slots a crew registered after activation after the last', async () => {
      await runs.slotForLateEntry({ id: 'v3', status: EntryStatus.REGISTERED });
      expect((await runOf('v3')).plannedStartTime).toEqual(at(3 * MIN));
    });

    it('gives no slot to a crew registered as withdrawn', async () => {
      await runs.slotForLateEntry({ id: 'v3', status: EntryStatus.WITHDRAWN });
      expect(await runOf('v3')).toBeUndefined();
    });

    it('tells every screen when New slot or Delay changes a slot time', async () => {
      await runs.newSlot('v1', 'SS1', null);
      await runs.delaySlots('SS1', MIN, null);
      expect(stageChanged).toHaveBeenCalledTimes(2);
      expect(stageChanged).toHaveBeenCalledWith('SS1');
    });

    /** v1's run as read just before its start passing landed. */
    async function staleAfterPassing() {
      const stale = { ...(await runOf('v1')) };
      await pass('START', stale.plannedStartTime!, -500, '111');
      return stale;
    }

    it('refuses New slot when the car leaves between the read and the write', async () => {
      const stale = await staleAfterPassing();
      jest
        .spyOn(runs as unknown as { findActive: () => unknown }, 'findActive')
        .mockResolvedValueOnce(stale);
      await expect(runs.newSlot('v1', 'SS1', null)).rejects.toMatchObject({
        response: { code: 'slotAlreadyLeft' },
      });
      const run = await runOf('v1');
      expect(run.plannedStartTime).toEqual(at(0));
      expect(run.startPassingAt).toEqual(at(-500));
      expect(await changes()).toHaveLength(0);
    });

    it('leaves a car that left during a Delay on its slot, its passing kept', async () => {
      const stale = await staleAfterPassing();
      jest
        .spyOn(dataSource.getRepository(StageRun), 'find')
        .mockResolvedValueOnce([stale, await runOf('v2')]);
      await runs.delaySlots('SS1', MIN, null);
      const v1 = await runOf('v1');
      expect(v1.plannedStartTime).toEqual(at(0));
      expect(v1.startPassingAt).toEqual(at(-500));
      expect((await runOf('v2')).plannedStartTime).toEqual(at(2 * MIN));
    });

    it('marks a car at the start before its slot is due', async () => {
      await pass('PRE', new Date(), 0, '111');
      expect(await events.entriesAtStart('SS1')).toEqual(['v1']);
    });
  });

  describe('a slot nobody drove', () => {
    it('is DNS once the stage closes, a driven unfinished one DNF', () => {
      const slot = new Date();
      expect(
        deriveStageRunStatus(
          { finishTime: null, plannedStartTime: slot, startPassingAt: null },
          true,
        ),
      ).toBe(StageRunStatus.DID_NOT_START);
      expect(
        deriveStageRunStatus(
          { finishTime: null, plannedStartTime: slot, startPassingAt: slot },
          true,
        ),
      ).toBe(StageRunStatus.CANCELLED);
      expect(
        deriveStageRunStatus(
          { finishTime: null, plannedStartTime: slot, startPassingAt: null },
          false,
        ),
      ).toBe(StageRunStatus.STARTED);
    });
  });
});
