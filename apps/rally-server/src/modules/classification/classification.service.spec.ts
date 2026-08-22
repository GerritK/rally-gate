import { StageStatus } from '@rally-gate/shared';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { GatesService } from '../gates/gates.service';
import { StageRunsService } from '../stage-runs/stage-runs.service';
import { StagesService } from '../stages/stages.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { ClassificationService } from './classification.service';

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
  );
}

function makeOverallService(finishedRuns: unknown[], vehicles: unknown[]) {
  const stageRunsService = {
    findAllFinished: jest.fn().mockResolvedValue(finishedRuns),
  } as unknown as StageRunsService;
  const vehiclesService = {
    findAll: jest.fn().mockResolvedValue(vehicles),
  } as unknown as VehiclesService;
  return new ClassificationService(
    stageRunsService,
    {} as unknown as StagesService,
    vehiclesService,
    {} as unknown as GatesService,
    {} as unknown as GateAssignmentsService,
  );
}

describe('ClassificationService.getOverallClassification', () => {
  const vehicles = [
    { id: 'v1', startNumber: '1', driverName: 'Went the distance' },
    { id: 'v2', startNumber: '2', driverName: 'Quick but retired' },
  ];

  // v2 has the smaller total (60s vs 200s) purely because it stopped after
  // one stage. Ranking on time alone would hand it the rally lead.
  const runs = [
    { vehicleId: 'v1', stageId: 'SS1', durationMs: 100_000 },
    { vehicleId: 'v1', stageId: 'SS2', durationMs: 100_000 },
    { vehicleId: 'v2', stageId: 'SS1', durationMs: 60_000 },
  ];

  it('ranks more stages completed above a quicker total over fewer', async () => {
    const service = makeOverallService(runs, vehicles);

    const result = await service.getOverallClassification();

    expect(result.map((e) => [e.vehicleId, e.position])).toEqual([
      ['v1', 1],
      ['v2', 2],
    ]);
  });

  it('reports no time gap against a leader on more stages', async () => {
    // v2's total is 140s *smaller* than the leader's, so an arithmetic gap
    // would be -140s and read as though it were ahead.
    const service = makeOverallService(runs, vehicles);

    const [leader, behind] = await service.getOverallClassification();

    expect(leader.gapMs).toBe(0);
    expect(behind.gapMs).toBeNull();
    expect(behind.stagesCompleted).toBe(1);
  });

  it('reports a real time gap between crews on the same stage count', async () => {
    const service = makeOverallService(
      [
        { vehicleId: 'v1', stageId: 'SS1', durationMs: 100_000 },
        { vehicleId: 'v2', stageId: 'SS1', durationMs: 130_000 },
      ],
      vehicles,
    );

    const [leader, second] = await service.getOverallClassification();

    expect(leader.vehicleId).toBe('v1');
    expect(second.gapMs).toBe(30_000);
  });

  it('counts stages completed rather than trusting run order', async () => {
    const service = makeOverallService(runs, vehicles);

    const result = await service.getOverallClassification();

    expect(result[0]).toMatchObject({
      vehicleId: 'v1',
      stagesCompleted: 2,
      durationMs: 200_000,
    });
  });

  it('returns an empty classification before anyone has finished a stage', async () => {
    const service = makeOverallService([], vehicles);

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
