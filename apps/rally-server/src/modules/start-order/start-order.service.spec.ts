import {
  START_ORDER_DIRECTION_KEY,
  EntryStatus,
  START_ORDER_GROUPING_KEY,
  START_ORDER_KEY_KEY,
  StageScoring,
  StageStatus,
  StartOrderDirection,
  StartOrderGrouping,
  StartOrderKey,
  StartMode,
} from '@rally-gate/shared';
import { ClassificationService } from '../classification/classification.service';
import { SettingsService } from '../settings/settings.service';
import { Stage } from '../stages/stage.entity';
import { StagesService } from '../stages/stages.service';
import { StageRun } from '../stage-runs/stage-run.entity';
import { StageRunsService } from '../stage-runs/stage-runs.service';
import { EntriesService } from '../entries/entries.service';
import { StartOrderService } from './start-order.service';

const twoWd = { id: 'c2', name: '2WD', main: true };
const fourWd = { id: 'c4', name: '4WD', main: true };
const rookie = { id: 'cr', name: 'Rookie', main: false };

// Sorted by start number, as `EntriesService.findAll` returns them.
const entries = [
  { id: 'a', startNumber: 1, driverFirstName: 'A', classes: [fourWd] },
  { id: 'b', startNumber: 2, driverFirstName: 'B', classes: [twoWd, rookie] },
  { id: 'c', startNumber: 3, driverFirstName: 'C', classes: [] },
  { id: 'd', startNumber: 10, driverFirstName: 'D', classes: [twoWd] },
  { id: 'e', startNumber: 11, driverFirstName: 'E', classes: [fourWd] },
];

function makeService(
  settings: Record<string, string>,
  times: { overall?: Record<string, number>; stage?: Record<string, number> },
  stage: Partial<Stage> & { startOrder: string[] | null } = {
    startOrder: null,
  },
  entrants: unknown[] = entries,
  firstScoring = StageScoring.OVERALL,
  runs: Partial<StageRun>[] = [],
) {
  const stages = [
    {
      id: 'SS1',
      stageNumber: 1,
      status: StageStatus.CLOSED,
      scoring: firstScoring,
    },
    { id: 'SS2', stageNumber: 2, status: StageStatus.NOT_STARTED, ...stage },
  ];
  const toPlacings = (map: Record<string, number> = {}) =>
    Object.entries(map).map(([entryId, durationMs]) => ({
      entryId,
      durationMs,
    }));
  const classification = {
    getOverallClassification: jest
      .fn()
      .mockResolvedValue(toPlacings(times.overall)),
    getStageClassification: jest
      .fn()
      .mockResolvedValue(toPlacings(times.stage)),
  };
  const stagesService = {
    findOneOrFail: jest.fn((id: string) =>
      Promise.resolve(stages.find((s) => s.id === id)),
    ),
    findAll: jest.fn().mockResolvedValue(stages),
    setStartOrder: jest.fn().mockResolvedValue(undefined),
  };
  const stageRunsService = {
    findByStage: jest.fn().mockResolvedValue(runs),
    createTimetableRuns: jest.fn().mockResolvedValue(undefined),
  };
  const service = new StartOrderService(
    stagesService as unknown as StagesService,
    {
      findAll: jest.fn().mockResolvedValue(entrants),
    } as unknown as EntriesService,
    classification as unknown as ClassificationService,
    {
      get: jest.fn((key: string) => Promise.resolve(settings[key] ?? null)),
    } as unknown as SettingsService,
    stageRunsService as unknown as StageRunsService,
  );
  return { service, stagesService, classification, stageRunsService };
}

const order = async (service: StartOrderService, stageId = 'SS2') =>
  (await service.getStartOrder(stageId)).starters.map((e) => e.entryId);

describe('StartOrderService', () => {
  const withOut = entries.map((v) =>
    v.id === 'd'
      ? { ...v, status: EntryStatus.WITHDRAWN }
      : v.id === 'a'
        ? { ...v, status: EntryStatus.DISQUALIFIED }
        : v,
  );

  it('leaves a withdrawn or disqualified car off a list still computed', async () => {
    const { service } = makeService({}, {}, undefined, withOut);
    expect(await order(service)).toEqual(['b', 'e', 'c']);
  });

  it('keeps a frozen list as posted, a car since withdrawn included', async () => {
    // Positions on a posted list must not shift; Live Timing shows the car
    // as out instead.
    const { service } = makeService(
      {},
      {},
      { startOrder: ['a', 'b', 'c', 'd', 'e'] },
      withOut,
    );
    expect(await order(service)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('defaults to main classes alphabetically by start number, no main class last', async () => {
    const { service } = makeService({}, {});
    // 10 after 2: numeric, not string order.
    expect(await order(service)).toEqual(['b', 'd', 'a', 'e', 'c']);
  });

  it('sorts by overall time within the class ranking, no time last', async () => {
    const { service, classification } = makeService(
      {
        [START_ORDER_KEY_KEY]: StartOrderKey.OVERALL_TIME,
        [START_ORDER_DIRECTION_KEY]: StartOrderDirection.SLOWEST_FIRST,
      },
      { overall: { a: 100, e: 200, b: 300 } },
    );
    // 2WD: b has a time, d hasn't. 4WD: e slower than a, so first.
    expect(await order(service)).toEqual(['b', 'd', 'e', 'a', 'c']);
    expect(classification.getOverallClassification).toHaveBeenCalledWith([
      'c4',
    ]);
  });

  it('breaks time ties by start number and ignores grouping when NONE', async () => {
    const { service } = makeService(
      {
        [START_ORDER_GROUPING_KEY]: StartOrderGrouping.NONE,
        [START_ORDER_KEY_KEY]: StartOrderKey.LAST_STAGE_TIME,
      },
      { stage: { e: 50, a: 50, c: 10 } },
    );
    expect(await order(service)).toEqual(['c', 'a', 'e', 'b', 'd']);
    expect((await service.getStartOrder('SS2')).grouped).toBe(false);
  });

  it('falls back to start number on stage 1 under last stage time', async () => {
    const { service, classification } = makeService(
      {
        [START_ORDER_GROUPING_KEY]: StartOrderGrouping.NONE,
        [START_ORDER_KEY_KEY]: StartOrderKey.LAST_STAGE_TIME,
      },
      { stage: { e: 1 } },
    );
    expect(await order(service, 'SS1')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(classification.getStageClassification).not.toHaveBeenCalled();
  });

  it('orders by the qualifying stage under overall time until a counted stage closed', async () => {
    const { service, classification } = makeService(
      {
        [START_ORDER_GROUPING_KEY]: StartOrderGrouping.NONE,
        [START_ORDER_KEY_KEY]: StartOrderKey.OVERALL_TIME,
      },
      { stage: { e: 10, c: 20 } },
      undefined,
      entries,
      StageScoring.QUALIFYING,
    );
    expect(await order(service)).toEqual(['e', 'c', 'a', 'b', 'd']);
    expect(classification.getStageClassification).toHaveBeenCalledWith('SS1');
    expect(classification.getOverallClassification).not.toHaveBeenCalled();
  });

  it('skips a stage outside the overall under last stage time', async () => {
    const { service, classification } = makeService(
      {
        [START_ORDER_GROUPING_KEY]: StartOrderGrouping.NONE,
        [START_ORDER_KEY_KEY]: StartOrderKey.LAST_STAGE_TIME,
      },
      { stage: { e: 1 } },
      undefined,
      entries,
      StageScoring.NONE,
    );
    expect(await order(service)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(classification.getStageClassification).not.toHaveBeenCalled();
  });

  it('serves a frozen list as stored and appends late entries by start number', async () => {
    const { service } = makeService({}, {}, { startOrder: ['e', 'gone', 'a'] });
    const result = await service.getStartOrder('SS2');
    expect(result.frozen).toBe(true);
    expect(result.grouped).toBe(true);
    expect(result.starters.map((e) => e.entryId)).toEqual([
      'e',
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('freezes on activation only once', async () => {
    const { service, stagesService } = makeService({}, {});
    await service.freezeOnActivation({
      id: 'SS2',
      stageNumber: 2,
      startOrder: null,
    } as never);
    expect(stagesService.setStartOrder).toHaveBeenCalledWith('SS2', [
      'b',
      'd',
      'a',
      'e',
      'c',
    ]);
    stagesService.setStartOrder.mockClear();
    // Frozen by hand beforehand: activation keeps the published list.
    await service.freezeOnActivation({ id: 'SS2', startOrder: ['a'] } as never);
    expect(stagesService.setStartOrder).not.toHaveBeenCalled();
  });

  it('freezes by hand, and leaves an already frozen list alone', async () => {
    const { service, stagesService } = makeService({}, {});
    await service.freeze('SS2');
    expect(stagesService.setStartOrder).toHaveBeenCalledTimes(1);

    const frozen = makeService({}, {}, { startOrder: ['a'] });
    await frozen.service.freeze('SS2');
    expect(frozen.stagesService.setStartOrder).not.toHaveBeenCalled();
  });

  it('unfreezes only before activation', async () => {
    const { service, stagesService } = makeService(
      {},
      {},
      { startOrder: ['a'] },
    );
    await service.unfreeze('SS2');
    expect(stagesService.setStartOrder).toHaveBeenCalledWith('SS2', null);

    const active = makeService(
      {},
      {},
      { startOrder: ['a'], status: StageStatus.ACTIVE },
    );
    await expect(active.service.unfreeze('SS2')).rejects.toThrow(
      /stays frozen/,
    );
    expect(active.stagesService.setStartOrder).not.toHaveBeenCalled();
  });

  describe('timetable', () => {
    const first = new Date('2026-11-07T10:00:00.000Z');
    const timetable = {
      startMode: StartMode.SLOT_SCHEDULE,
      firstStartTime: first,
      slotIntervalMs: 30_000,
    };
    const slotsOf = async (service: StartOrderService) =>
      Object.fromEntries(
        (await service.getStartOrder('SS2')).starters.map((e) => [
          e.entryId,
          e.slotTime,
        ]),
      );
    const at = (ms: number) => new Date(first.getTime() + ms).toISOString();

    it('gives slots only once the list is frozen', async () => {
      const { service } = makeService(
        {},
        {},
        { startOrder: null, ...timetable },
      );
      expect(Object.values(await slotsOf(service))).toEqual(
        entries.map(() => null),
      );
    });

    it('gives no slots on a stage that starts at the gate', async () => {
      const { service } = makeService(
        {},
        {},
        { startOrder: ['a', 'b'], ...timetable, startMode: StartMode.GATE },
      );
      expect((await slotsOf(service)).a).toBeNull();
    });

    it('is first start plus interval times position, 60 s by default', async () => {
      const { service } = makeService(
        {},
        {},
        { startOrder: ['c', 'a', 'b'], ...timetable, slotIntervalMs: null },
      );
      const slots = await slotsOf(service);
      expect([slots.c, slots.a, slots.b]).toEqual([
        at(0),
        at(60_000),
        at(120_000),
      ]);
    });

    it('leaves a withdrawn car its slot and puts a late crew after the last', async () => {
      const { service } = makeService(
        {},
        {},
        { startOrder: ['a', 'b', 'd'], ...timetable },
        withOut
          .filter((v) => v.id !== 'c' && v.id !== 'e')
          .concat({
            id: 'late',
            startNumber: 20,
            driverFirstName: 'L',
            classes: [],
          } as never),
      );
      expect(await slotsOf(service)).toEqual({
        a: at(0),
        b: at(30_000),
        d: at(60_000),
        late: at(90_000),
      });
    });

    it('reads the slots of a running stage from its slot runs', async () => {
      const { service } = makeService(
        {},
        {},
        { startOrder: ['a', 'b'], ...timetable, status: StageStatus.ACTIVE },
        entries.slice(0, 2),
        StageScoring.OVERALL,
        [
          {
            entryId: 'a',
            voided: false,
            plannedStartTime: new Date(at(90_000)),
          },
          { entryId: 'b', voided: true, plannedStartTime: new Date(at(0)) },
        ],
      );
      expect(await slotsOf(service)).toEqual({ a: at(90_000), b: at(30_000) });
    });

    it('refuses to freeze a timetable without a first start', async () => {
      const { service, stagesService } = makeService(
        {},
        {},
        { startOrder: null, ...timetable, firstStartTime: null },
      );
      await expect(service.freeze('SS2')).rejects.toThrow(/no first start/);
      expect(stagesService.setStartOrder).not.toHaveBeenCalled();
    });

    it('turns the slots into runs on activation, none for a car out of the event', async () => {
      const stage = {
        id: 'SS2',
        startOrder: ['a', 'b', 'd'],
        ...timetable,
        status: StageStatus.ACTIVE,
      };
      const { service, stageRunsService } = makeService(
        {},
        {},
        stage,
        withOut.filter((v) => v.id !== 'c' && v.id !== 'e'),
      );
      await service.freezeOnActivation(stage as unknown as Stage);
      expect(stageRunsService.createTimetableRuns).toHaveBeenCalledWith('SS2', [
        { entryId: 'b', slot: new Date(at(30_000)) },
      ]);
    });
  });
});
