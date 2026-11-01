import 'reflect-metadata';
import {
  ChangeAction,
  EntryStatus,
  StageRunStatus,
  StageScoring,
  StageStatus,
  StartMode,
} from '@rally-gate/shared';
import { DataSource } from 'typeorm';
import { ChangeRecord } from '../changes/change-record.entity';
import { ClassificationService } from '../classification/classification.service';
import { EntryClass } from '../entries/entry-class.entity';
import { EntryTransponder } from '../entries/entry-transponder.entity';
import { Entry } from '../entries/entry.entity';
import { Stage } from '../stages/stage.entity';
import { StagesService } from '../stages/stages.service';
import { DidNotStart } from './did-not-start.entity';
import { StageRun } from './stage-run.entity';
import { StageRunsService } from './stage-runs.service';
import { StageSplit } from './stage-split.entity';

/**
 * DNF and DNS end to end against real sqlite: the open-run index, the DNS
 * table and the close transaction are what a mocked repository can't check.
 */
describe('DNF and DNS', () => {
  let dataSource: DataSource;
  let stages: StagesService;
  let runs: StageRunsService;
  let classification: ClassificationService;
  let emitter: { emit: jest.Mock; emitAsync: jest.Mock };

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [
        StageRun,
        StageSplit,
        DidNotStart,
        ChangeRecord,
        Stage,
        Entry,
        EntryClass,
        EntryTransponder,
      ],
      synchronize: true,
    });
    await dataSource.initialize();
    emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    stages = new StagesService(
      dataSource.getRepository(Stage),
      {
        deactivateForStage: () => Promise.resolve(),
        findByStage: () => Promise.resolve([]),
      } as never,
      emitter as never,
      {} as never,
    );
    runs = new StageRunsService(
      dataSource.getRepository(StageRun),
      dataSource.getRepository(StageSplit),
      stages,
      emitter as never,
      {
        getNumber: (_key: string, fallback: number) =>
          Promise.resolve(fallback),
      } as never,
      dataSource.getRepository(DidNotStart),
    );
    classification = new ClassificationService(
      runs,
      stages,
      { findAll: () => dataSource.getRepository(Entry).find() } as never,
      {} as never,
      {} as never,
      {
        getNumber: (_key: string, fallback: number) =>
          Promise.resolve(fallback),
      } as never,
      { overallTotals: () => Promise.resolve(new Map()) } as never,
    );
    await addStage('SS1');
    for (const [id, startNumber] of [
      ['v1', 1],
      ['v2', 2],
      ['v3', 3],
    ] as const) {
      await addEntry(id, startNumber);
    }
  });

  afterEach(() => dataSource.destroy());

  function addStage(id: string, overrides: Partial<Stage> = {}) {
    return dataSource.getRepository(Stage).insert({
      id,
      name: id,
      stageNumber: Number(id.replace(/\D/g, '')),
      status: StageStatus.ACTIVE,
      ...overrides,
    });
  }

  function addEntry(
    id: string,
    startNumber: number,
    status = EntryStatus.CHECKED_IN,
  ) {
    return dataSource
      .getRepository(Entry)
      .insert({ id, startNumber, driverFirstName: id, status });
  }

  const at = (seconds: number) =>
    new Date(Date.UTC(2026, 10, 1, 10, 0, seconds));
  const runOf = (entryId: string, stageId = 'SS1') =>
    dataSource
      .getRepository(StageRun)
      .find({ where: { entryId, stageId }, order: { attempt: 'ASC' } });
  const dnsOf = (stageId = 'SS1') =>
    runs.findDns(stageId).then((rows) => rows.map((row) => row.entryId).sort());
  const outcomes = async (stageId = 'SS1') =>
    (await classification.getNonFinishers(stageId)).map((row) => [
      row.entryId,
      row.outcome,
    ]);
  const changes = (action: ChangeAction) =>
    dataSource.getRepository(ChangeRecord).findBy({ action });

  /** A slot run as a countdown makes one. */
  function slotRun(entryId: string, slot: Date, stageId = 'SS1') {
    return dataSource.getRepository(StageRun).save({
      entryId,
      stageId,
      startTime: slot,
      plannedStartTime: slot,
    });
  }

  describe('DNF', () => {
    it('takes the car off stage at once, into the non-finishers', async () => {
      const run = await runs.startRun('v1', 'SS1', at(0));
      const retired = await runs.retireRun(run.id, 'd1');
      expect(retired.status).toBe(StageRunStatus.CANCELLED);
      expect(await outcomes()).toEqual([['v1', 'DNF']]);
      expect(await changes(ChangeAction.RUN_RETIRED)).toHaveLength(1);
      expect(emitter.emit).toHaveBeenCalledWith(
        'stage-run.updated',
        expect.objectContaining({ id: run.id, retired: true }),
      );
    });

    it('is undone while the stage runs, and the car is on stage again', async () => {
      const run = await runs.startRun('v1', 'SS1', at(0));
      await runs.retireRun(run.id, null);
      const back = await runs.unretireRun(run.id, null);
      expect(back.status).toBe(StageRunStatus.STARTED);
      expect(await outcomes()).toEqual([]);
      expect(await changes(ChangeAction.RUN_UNRETIRED)).toHaveLength(1);
    });

    it('refuses a finished run, and DNF or its undo once the stage closed', async () => {
      const finished = await runs.startRun('v1', 'SS1', at(0));
      await runs.finishRun('v1', 'SS1', at(60));
      await expect(runs.retireRun(finished.id, null)).rejects.toMatchObject({
        response: { code: 'runNotRetirable' },
      });
      const open = await runs.startRun('v2', 'SS1', at(10));
      await runs.retireRun(open.id, null);
      await stages.close('SS1');
      await expect(runs.unretireRun(open.id, null)).rejects.toMatchObject({
        response: { code: 'stageAlreadyClosed' },
      });
    });

    it('stores a finish passing after it as evidence and times nothing', async () => {
      const run = await runs.startRun('v1', 'SS1', at(0));
      await runs.retireRun(run.id, null);
      expect(await runs.finishRun('v1', 'SS1', at(60))).toBeNull();
      expect(
        await runs.recordSplit('v1', 'SS1', 'SPLIT', 1, at(30)),
      ).toBeNull();
      // Not pending for a start still on its way: the car has its run.
      expect(await runs.hasRun('v1', 'SS1')).toBe(true);
      const [stored] = await runOf('v1');
      expect(stored).toMatchObject({ retired: true, finishTime: null });
    });

    it('ignores a restart at the start gate on a counted stage', async () => {
      const run = await runs.startRun('v1', 'SS1', at(0));
      await runs.retireRun(run.id, null);
      await runs.startRun('v1', 'SS1', at(90));
      expect(await runOf('v1')).toHaveLength(1);
    });

    it('drops its splits out of the live split ranking', async () => {
      const run = await runs.startRun('v1', 'SS1', at(0));
      await runs.recordSplit('v1', 'SS1', 'SPLIT', 1, at(30));
      expect(await runs.findSplitsForStageAtIndex('SS1', 1)).toHaveLength(1);
      await runs.retireRun(run.id, null);
      expect(await runs.findSplitsForStageAtIndex('SS1', 1)).toEqual([]);
    });

    it('is cleared by a finish typed in by correction', async () => {
      const run = await runs.startRun('v1', 'SS1', at(0));
      await runs.retireRun(run.id, null);
      const corrected = await runs.correctRun(
        run.id,
        { finishTime: at(75).toISOString() },
        null,
      );
      expect(corrected).toMatchObject({
        status: StageRunStatus.FINISHED,
        retired: false,
        durationMs: 75_000,
      });
    });

    it('only ends the open run on a shakedown, so the car can start again', async () => {
      await addStage('SD9', { scoring: StageScoring.NONE });
      const first = await runs.startRun('v1', 'SD9', at(0));
      await runs.retireRun(first.id, null);
      const second = await runs.startRun('v1', 'SD9', at(120));
      expect(second).toMatchObject({ run: 2, status: StageRunStatus.STARTED });
      // Undoing the first would make two open runs.
      await expect(runs.unretireRun(first.id, null)).rejects.toMatchObject({
        response: { code: 'otherAttemptCounts' },
      });
    });
  });

  describe('DNS', () => {
    it('lists the car as DNS at once, and is undone while the stage runs', async () => {
      await runs.markDns('v2', 'SS1', 'd1');
      expect(await outcomes()).toEqual([['v2', 'DNS']]);
      expect(emitter.emit).toHaveBeenCalledWith('dns.changed', {
        entryId: 'v2',
        stageId: 'SS1',
        dns: true,
      });
      await runs.undoDns('v2', 'SS1', 'd1');
      expect(await outcomes()).toEqual([]);
      expect(await changes(ChangeAction.DNS_MARKED)).toHaveLength(1);
      expect(await changes(ChangeAction.DNS_UNDONE)).toHaveLength(1);
    });

    it('refuses a car with a counting run, a shakedown, a stage not running', async () => {
      await runs.startRun('v1', 'SS1', at(0));
      await expect(runs.markDns('v1', 'SS1', null)).rejects.toMatchObject({
        response: { code: 'attemptAlreadyCounts' },
      });
      await addStage('SD9', { scoring: StageScoring.NONE });
      await expect(runs.markDns('v2', 'SD9', null)).rejects.toMatchObject({
        response: { code: 'dnsOnShakedown' },
      });
      await addStage('SS2', { status: StageStatus.NOT_STARTED });
      await expect(runs.markDns('v2', 'SS2', null)).rejects.toMatchObject({
        response: { code: 'stageNotStarted' },
      });
    });

    it('deletes an untouched slot run as a cancelled countdown, leaving its slot empty', async () => {
      await addStage('SS2', { startMode: StartMode.SLOT_MANUAL });
      const slot = await slotRun('v1', at(0), 'SS2');
      await runs.markDns('v1', 'SS2', null);
      expect(await runOf('v1', 'SS2')).toEqual([]);
      expect(await dnsOf('SS2')).toEqual(['v1']);
      expect(await changes(ChangeAction.COUNTDOWN_CANCELLED)).toHaveLength(1);
      expect(emitter.emit).toHaveBeenCalledWith('stage-run.deleted', {
        id: slot.id,
        stageId: 'SS2',
      });
    });

    it('keeps a slot run the car drove: a start passing or a split', async () => {
      await addStage('SS2', { startMode: StartMode.SLOT_MANUAL });
      await slotRun('v1', at(0), 'SS2');
      await runs.recordStartPassing('v1', 'SS2', at(0));
      const unpassed = await slotRun('v2', at(30), 'SS2');
      await dataSource.getRepository(StageSplit).save({
        stageRunId: unpassed.id,
        gateId: 'SPLIT',
        splitIndex: 1,
        timestamp: at(60),
        elapsedMs: 30_000,
      });
      for (const entryId of ['v1', 'v2']) {
        await expect(runs.markDns(entryId, 'SS2', null)).rejects.toMatchObject({
          response: { code: 'attemptAlreadyCounts' },
        });
      }
    });

    it('is cleared by a start passing at the gate', async () => {
      await runs.markDns('v1', 'SS1', null);
      await runs.startRun('v1', 'SS1', at(0));
      expect(await dnsOf()).toEqual([]);
      expect(emitter.emit).toHaveBeenCalledWith('dns.changed', {
        entryId: 'v1',
        stageId: 'SS1',
        dns: false,
      });
    });

    it('is cleared by Start now and by a run typed in', async () => {
      await runs.markDns('v1', 'SS1', null);
      await runs.markDns('v2', 'SS1', null);
      await runs.createManual({ entryId: 'v1', stageId: 'SS1' }, null);
      await runs.createManual(
        {
          entryId: 'v2',
          stageId: 'SS1',
          startTime: at(0).toISOString(),
          finishTime: at(80).toISOString(),
        },
        null,
      );
      expect(await dnsOf()).toEqual([]);
    });
  });

  describe('closing a stage', () => {
    it('writes DNF for open runs and DNS for cars without a run, in stored rows', async () => {
      await addEntry('w1', 11, EntryStatus.WITHDRAWN);
      await addEntry('q1', 12, EntryStatus.DISQUALIFIED);
      await runs.startRun('v1', 'SS1', at(0));
      await runs.startRun('v2', 'SS1', at(10));
      await runs.finishRun('v2', 'SS1', at(70));
      await stages.close('SS1');
      const [open] = await runOf('v1');
      expect(open.retired).toBe(true);
      expect((await runOf('v2'))[0].retired).toBe(false);
      // Withdrawn and disqualified cars are neither.
      expect(await dnsOf()).toEqual(['v3']);
      expect(await outcomes()).toEqual([
        ['v1', 'DNF'],
        ['v3', 'DNS'],
      ]);
      expect(emitter.emit).toHaveBeenCalledWith(
        'stage-run.updated',
        expect.objectContaining({
          id: open.id,
          status: StageRunStatus.CANCELLED,
        }),
      );
    });

    it('turns a slot nobody drove into DNS, one with a split into DNF', async () => {
      await dataSource
        .getRepository(Stage)
        .update('SS1', { startMode: StartMode.SLOT_MANUAL });
      const untouched = await slotRun('v1', at(0));
      const split = await slotRun('v2', at(30));
      await runs.recordSplit('v2', 'SS1', 'SPLIT', 1, at(60));
      await slotRun('v3', at(60));
      await runs.recordStartPassing('v3', 'SS1', at(60));
      await stages.close('SS1');
      expect(await runOf('v1')).toEqual([]);
      expect((await runOf('v2'))[0]).toMatchObject({
        id: split.id,
        retired: true,
      });
      expect((await runOf('v3'))[0].retired).toBe(true);
      expect(await dnsOf()).toEqual(['v1']);
      expect(emitter.emit).toHaveBeenCalledWith('stage-run.deleted', {
        id: untouched.id,
        stageId: 'SS1',
      });
    });

    it('writes no DNS on a shakedown, and keeps a DNS a marshal set', async () => {
      await addStage('SD9', { scoring: StageScoring.NONE });
      const run = await runs.startRun('v1', 'SD9', at(0));
      await stages.close('SD9');
      expect(await dnsOf('SD9')).toEqual([]);
      expect((await runOf('v1', 'SD9'))[0]).toMatchObject({
        id: run.id,
        retired: true,
      });

      await runs.markDns('v2', 'SS1', null);
      await stages.close('SS1');
      expect(await dnsOf()).toEqual(['v1', 'v2', 'v3']);
    });

    it('leaves a run typed in on a closed stage without a finish DNF', async () => {
      await stages.close('SS1');
      const run = await runs.createManual(
        { entryId: 'v1', stageId: 'SS1', startTime: at(0).toISOString() },
        null,
      );
      expect(run.status).toBe(StageRunStatus.CANCELLED);
    });

    it('gives a crew registered after close no DNS, but still a notional time', async () => {
      await runs.startRun('v1', 'SS1', at(0));
      await runs.finishRun('v1', 'SS1', at(100));
      await stages.close('SS1');
      await addEntry('late', 9);
      await addStage('SS2');
      await runs.startRun('late', 'SS2', at(200));
      await runs.finishRun('late', 'SS2', at(290));
      await runs.startRun('v1', 'SS2', at(210));
      await runs.finishRun('v1', 'SS2', at(300));
      await stages.close('SS2');

      expect(await outcomes('SS1')).toEqual([
        ['v2', 'DNS'],
        ['v3', 'DNS'],
      ]);
      const late = (await classification.getOverallClassification()).find(
        (row) => row.entryId === 'late',
      );
      expect(late?.stageTimes[0]).toMatchObject({
        stageId: 'SS1',
        notional: true,
      });
    });
  });
});
