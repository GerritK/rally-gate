import { StageStatus } from '@rally-gate/shared';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { GatesService } from '../gates/gates.service';
import { SettingsService } from '../settings/settings.service';
import { StageRunsService } from '../stage-runs/stage-runs.service';
import { StagesService } from '../stages/stages.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import {
  ClassificationService,
  DEFAULT_NOTIONAL_PENALTY_MS,
} from './classification.service';

function makeService(
  stage: { status: StageStatus },
  runs: unknown[],
  vehicles: unknown[],
) {
  const stagesService = {
    findOne: jest.fn().mockResolvedValue(stage),
  } as unknown as StagesService;
  const stageRunsService = {
    findByStage: jest.fn().mockResolvedValue(runs),
  } as unknown as StageRunsService;
  const vehiclesService = {
    findAll: jest.fn().mockResolvedValue(vehicles),
  } as unknown as VehiclesService;
  const gatesService = {} as unknown as GatesService;
  const gateAssignmentsService = {} as unknown as GateAssignmentsService;
  return new ClassificationService(
    stageRunsService,
    stagesService,
    vehiclesService,
    gatesService,
    gateAssignmentsService,
    {} as unknown as SettingsService,
  );
}

function makeOverallService(
  stages: { id: string; status: StageStatus }[],
  finishedRuns: unknown[],
  vehicles: unknown[],
  notionalPenaltyMs = DEFAULT_NOTIONAL_PENALTY_MS,
) {
  const stageRunsService = {
    findAllFinished: jest.fn().mockResolvedValue(finishedRuns),
  } as unknown as StageRunsService;
  const stagesService = {
    findAll: jest.fn().mockResolvedValue(stages),
  } as unknown as StagesService;
  const vehiclesService = {
    findAll: jest.fn().mockResolvedValue(vehicles),
  } as unknown as VehiclesService;
  const settingsService = {
    getNumber: jest.fn().mockResolvedValue(notionalPenaltyMs),
  } as unknown as SettingsService;
  return new ClassificationService(
    stageRunsService,
    stagesService,
    vehiclesService,
    {} as unknown as GatesService,
    {} as unknown as GateAssignmentsService,
    settingsService,
  );
}

describe('ClassificationService.getOverallClassification', () => {
  const vehicles = [
    { id: 'v1', startNumber: '1', driverName: 'Went the distance' },
    { id: 'v2', startNumber: '2', driverName: 'Quick but retired' },
  ];
  const twoClosed = [
    { id: 'SS1', status: StageStatus.CLOSED },
    { id: 'SS2', status: StageStatus.CLOSED },
  ];

  // v2 is quicker on SS1 (60s vs 100s) but never completes SS2. Without a
  // notional its total is 60s against v1's 200s and it "wins" the rally.
  const runs = [
    { vehicleId: 'v1', stageId: 'SS1', durationMs: 100_000 },
    { vehicleId: 'v1', stageId: 'SS2', durationMs: 100_000 },
    { vehicleId: 'v2', stageId: 'SS1', durationMs: 60_000 },
  ];

  it('substitutes a notional time for a stage the crew did not complete', async () => {
    const service = makeOverallService(twoClosed, runs, vehicles);

    const result = await service.getOverallClassification();

    // v2: real 60s on SS1, plus notional on SS2 = slowest there (100s, v1's
    // only time) + 30s penalty = 130s. Total 190s.
    expect(result.map((e) => [e.vehicleId, e.durationMs])).toEqual([
      ['v2', 190_000],
      ['v1', 200_000],
    ]);
  });

  it('keeps a notional worse than the real time it replaces', async () => {
    // The property everything else rests on: v2 is charged 130s for SS2,
    // strictly more than the 100s it would have taken to actually drive it,
    // so skipping a stage never pays off *on that stage*.
    const service = makeOverallService(twoClosed, runs, vehicles);

    const result = await service.getOverallClassification();
    const retired = result.find((e) => e.vehicleId === 'v2')!;

    expect(retired.durationMs - 60_000).toBeGreaterThan(100_000);
  });

  it('ranks on total time alone once notionals make totals comparable', async () => {
    // v2 leads on 190s despite completing only one stage, because it was 40s
    // quicker on SS1 and the penalty only costs it 30s. That is the correct
    // rally answer — lowest total wins — and it is the reason a
    // stages-completed sort must NOT override total time.
    //
    // It also shows the penalty is the knob that decides how punishing a
    // retirement is: see the larger-penalty case below.
    const service = makeOverallService(twoClosed, runs, vehicles);

    const result = await service.getOverallClassification();

    expect(result.map((e) => [e.vehicleId, e.position, e.gapMs])).toEqual([
      ['v2', 1, 0],
      ['v1', 2, 10_000],
    ]);
  });

  it('reports stages actually driven, not stages counted', async () => {
    const service = makeOverallService(twoClosed, runs, vehicles);

    const result = await service.getOverallClassification();

    expect(result.map((e) => [e.vehicleId, e.stagesCompleted])).toEqual([
      ['v2', 1],
      ['v1', 2],
    ]);
  });

  it('sinks a crew below a finisher once the penalty outweighs its pace', async () => {
    const service = makeOverallService(twoClosed, runs, vehicles, 60_000);

    const result = await service.getOverallClassification();

    // Same runs, bigger penalty: v2's SS2 notional becomes 160s, total 220s.
    expect(result.map((e) => [e.vehicleId, e.position])).toEqual([
      ['v1', 1],
      ['v2', 2],
    ]);
  });

  it('ignores stages that are not closed yet', async () => {
    // SS2 is still running, so v1 finishing it must not count and v2 must
    // not be penalised for a stage nobody has completed.
    const service = makeOverallService(
      [
        { id: 'SS1', status: StageStatus.CLOSED },
        { id: 'SS2', status: StageStatus.ACTIVE },
      ],
      runs,
      vehicles,
    );

    const result = await service.getOverallClassification();

    expect(result.map((e) => [e.vehicleId, e.durationMs])).toEqual([
      ['v2', 60_000],
      ['v1', 100_000],
    ]);
  });

  it('excludes a registered car that never completed a stage', async () => {
    // Otherwise a no-show collects notionals for the whole rally and lands
    // in the results on an entirely invented total.
    const service = makeOverallService(twoClosed, runs, [
      ...vehicles,
      { id: 'v3', startNumber: '3', driverName: 'Never turned up' },
    ]);

    const result = await service.getOverallClassification();

    expect(result.map((e) => e.vehicleId)).toEqual(['v2', 'v1']);
  });

  it('drops a closed stage nobody finished instead of inventing a basis', async () => {
    const service = makeOverallService(
      [...twoClosed, { id: 'SS3', status: StageStatus.CLOSED }],
      runs,
      vehicles,
    );

    const result = await service.getOverallClassification();

    // SS3 contributes nothing: with no real time to anchor a notional, every
    // crew would receive the same invented figure and no position would move.
    expect(result.map((e) => e.durationMs)).toEqual([190_000, 200_000]);
  });

  it('returns nothing before any stage has closed', async () => {
    const service = makeOverallService(
      [{ id: 'SS1', status: StageStatus.ACTIVE }],
      runs,
      vehicles,
    );

    await expect(service.getOverallClassification()).resolves.toEqual([]);
  });
});

describe('ClassificationService.getStageClassification', () => {
  it('still ranks a single stage on time alone, with real gaps', async () => {
    // The overall fix must not leak into per-stage ranking, where every
    // entry is one run and totals are directly comparable.
    const vehicles = [
      { id: 'v1', startNumber: '1', driverName: 'A' },
      { id: 'v2', startNumber: '2', driverName: 'B' },
    ];
    const stagesService = {
      findOne: jest.fn().mockResolvedValue({ status: StageStatus.CLOSED }),
    } as unknown as StagesService;
    const stageRunsService = {
      findFinishedByStage: jest.fn().mockResolvedValue([
        { vehicleId: 'v2', durationMs: 130_000 },
        { vehicleId: 'v1', durationMs: 100_000 },
      ]),
    } as unknown as StageRunsService;
    const service = new ClassificationService(
      stageRunsService,
      stagesService,
      {
        findAll: jest.fn().mockResolvedValue(vehicles),
      } as unknown as VehiclesService,
      {} as unknown as GatesService,
      {} as unknown as GateAssignmentsService,
      {} as unknown as SettingsService,
    );

    const result = await service.getStageClassification('SS1');

    expect(result.map((e) => [e.vehicleId, e.position, e.gapMs])).toEqual([
      ['v1', 1, 0],
      ['v2', 2, 30_000],
    ]);
  });
});

describe('ClassificationService.getNonFinishers', () => {
  const vehicles = [
    { id: 'v1', startNumber: '1', driverName: 'Started, no finish' },
    { id: 'v2', startNumber: '2', driverName: 'Never started' },
    { id: 'v3', startNumber: '3', driverName: 'Finished' },
  ];

  it('reports no one while the stage is still open, even with no runs yet', async () => {
    const service = makeService(
      { status: StageStatus.NOT_STARTED },
      [],
      vehicles,
    );
    expect(await service.getNonFinishers('WP1')).toEqual([]);
  });

  it('reports no one before the stage closes, even with an unfinished run — it is still running, not DNF', async () => {
    const runs = [{ vehicleId: 'v1', finishTime: undefined }];
    const service = makeService(
      { status: StageStatus.NOT_STARTED },
      runs,
      vehicles,
    );
    expect(await service.getNonFinishers('WP1')).toEqual([]);
  });

  it('reports DNF (unfinished run) and DNS (no run at all) once the stage is closed', async () => {
    const runs = [
      { vehicleId: 'v1', finishTime: undefined },
      { vehicleId: 'v3', finishTime: new Date() },
    ];
    const service = makeService({ status: StageStatus.CLOSED }, runs, vehicles);
    const result = await service.getNonFinishers('WP1');
    expect(result).toEqual([
      expect.objectContaining({ vehicleId: 'v1', outcome: 'DNF' }),
      expect.objectContaining({ vehicleId: 'v2', outcome: 'DNS' }),
    ]);
  });
});
