import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import {
  ChangeAction,
  DEFAULT_COUNTDOWN_MS,
  DEFAULT_MIN_START_GAP_MS,
  GateRole,
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
  };
  let roles: Record<string, GateRole>;
  let runs: StageRunsService;
  let events: EventsService;
  let emitter: { emit: jest.Mock };
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
    };
    roles = {
      START: GateRole.STAGE_START,
      FINISH: GateRole.STAGE_FINISH,
      SPLIT: GateRole.STAGE_SPLIT,
      LOOP: GateRole.STAGE_START_FINISH,
    };
    emitter = { emit: jest.fn() };
    const stagesService = {
      findOne: () => Promise.resolve(stage),
      findOneOrFail: () => Promise.resolve(stage),
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
  ): Promise<DetectionEventRecord> {
    const eventId = `e${++seq}`;
    await events.handleMqttMessage({
      topic: `rally/gates/${gateId}/detections`,
      payload: Buffer.from(
        JSON.stringify({
          eventId,
          gateId,
          transponderId,
          timestampGate: new Date(base.getTime() + offsetMs).toISOString(),
          source: 'test',
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
