import {
  START_ORDER_DIRECTION_KEY,
  VehicleStatus,
  START_ORDER_GROUPING_KEY,
  START_ORDER_KEY_KEY,
  StageStatus,
  StartOrderDirection,
  StartOrderGrouping,
  StartOrderKey,
} from '@rally-gate/shared';
import { ClassificationService } from '../classification/classification.service';
import { SettingsService } from '../settings/settings.service';
import { StagesService } from '../stages/stages.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { StartOrderService } from './start-order.service';

const twoWd = { id: 'c2', name: '2WD', main: true };
const fourWd = { id: 'c4', name: '4WD', main: true };
const rookie = { id: 'cr', name: 'Rookie', main: false };

// Sorted by start number, as `VehiclesService.findAll` returns them.
const vehicles = [
  { id: 'a', startNumber: 1, driverFirstName: 'A', classes: [fourWd] },
  { id: 'b', startNumber: 2, driverFirstName: 'B', classes: [twoWd, rookie] },
  { id: 'c', startNumber: 3, driverFirstName: 'C', classes: [] },
  { id: 'd', startNumber: 10, driverFirstName: 'D', classes: [twoWd] },
  { id: 'e', startNumber: 11, driverFirstName: 'E', classes: [fourWd] },
];

function makeService(
  settings: Record<string, string>,
  times: { overall?: Record<string, number>; stage?: Record<string, number> },
  stage: { startOrder: string[] | null; status?: StageStatus } = {
    startOrder: null,
  },
  entrants: unknown[] = vehicles,
) {
  const stages = [
    { id: 'SS1', stageNumber: 1, status: StageStatus.CLOSED },
    { id: 'SS2', stageNumber: 2, status: StageStatus.NOT_STARTED, ...stage },
  ];
  const toEntries = (map: Record<string, number> = {}) =>
    Object.entries(map).map(([vehicleId, durationMs]) => ({
      vehicleId,
      durationMs,
    }));
  const classification = {
    getOverallClassification: jest
      .fn()
      .mockResolvedValue(toEntries(times.overall)),
    getStageClassification: jest.fn().mockResolvedValue(toEntries(times.stage)),
  };
  const stagesService = {
    findOne: jest.fn((id: string) =>
      Promise.resolve(stages.find((s) => s.id === id) ?? null),
    ),
    findAll: jest.fn().mockResolvedValue(stages),
    setStartOrder: jest.fn().mockResolvedValue(undefined),
  };
  const service = new StartOrderService(
    stagesService as unknown as StagesService,
    {
      findAll: jest.fn().mockResolvedValue(entrants),
    } as unknown as VehiclesService,
    classification as unknown as ClassificationService,
    {
      get: jest.fn((key: string) => Promise.resolve(settings[key] ?? null)),
    } as unknown as SettingsService,
  );
  return { service, stagesService, classification };
}

const order = async (service: StartOrderService, stageId = 'SS2') =>
  (await service.getStartOrder(stageId)).entries.map((e) => e.vehicleId);

describe('StartOrderService', () => {
  const withOut = vehicles.map((v) =>
    v.id === 'd'
      ? { ...v, status: VehicleStatus.WITHDRAWN }
      : v.id === 'a'
        ? { ...v, status: VehicleStatus.DISQUALIFIED }
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

  it('serves a frozen list as stored and appends late entries by start number', async () => {
    const { service } = makeService({}, {}, { startOrder: ['e', 'gone', 'a'] });
    const result = await service.getStartOrder('SS2');
    expect(result.frozen).toBe(true);
    expect(result.grouped).toBe(true);
    expect(result.entries.map((e) => e.vehicleId)).toEqual([
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
});
