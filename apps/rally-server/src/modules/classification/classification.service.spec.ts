import { StageRunStatus, StageStatus } from '@rally-gate/shared';
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

  it('reports CANCELLED runs as DNF before the stage is closed, but no DNS yet', async () => {
    const runs = [{ vehicleId: 'v1', status: StageRunStatus.CANCELLED }];
    const service = makeService(
      { status: StageStatus.NOT_STARTED },
      runs,
      vehicles,
    );
    const result = await service.getNonFinishers('WP1');
    expect(result).toEqual([
      expect.objectContaining({ vehicleId: 'v1', outcome: 'DNF' }),
    ]);
  });

  it('reports DNF (cancelled, unfinished run) and DNS (no run at all) once the stage is closed', async () => {
    const runs = [
      { vehicleId: 'v1', status: StageRunStatus.CANCELLED },
      { vehicleId: 'v3', status: StageRunStatus.FINISHED },
    ];
    const service = makeService({ status: StageStatus.CLOSED }, runs, vehicles);
    const result = await service.getNonFinishers('WP1');
    expect(result).toEqual([
      expect.objectContaining({ vehicleId: 'v1', outcome: 'DNF' }),
      expect.objectContaining({ vehicleId: 'v2', outcome: 'DNS' }),
    ]);
  });
});
