import { StageStatus } from '@rally-gate/shared';
import { StagesService } from './stages.service';

type StageRow = { id: string; status: StageStatus };

function makeService(initialStages: StageRow[]) {
  const state: StageRow[] = initialStages.map((s) => ({ ...s }));
  const stages = {
    findOneBy: jest.fn(({ id }: { id: string }) => {
      const found = state.find((s) => s.id === id);
      return Promise.resolve(found ? { ...found } : null);
    }),
    save: jest.fn((s: StageRow) => {
      const idx = state.findIndex((row) => row.id === s.id);
      if (idx === -1) state.push({ ...s });
      else state[idx] = { ...s };
      return Promise.resolve({ ...s });
    }),
  };
  const gateAssignmentsService = {
    deactivateForStage: jest.fn().mockResolvedValue(undefined),
    activateForStage: jest.fn().mockResolvedValue({ deactivatedStageIds: [] }),
  };
  return {
    service: new StagesService(
      stages as never,
      gateAssignmentsService as never,
    ),
    gateAssignmentsService,
    state,
  };
}

describe('StagesService.close', () => {
  it('deactivates the stage gates before marking it closed', async () => {
    const { service, gateAssignmentsService } = makeService([
      { id: 'SS1', status: StageStatus.NOT_STARTED },
    ]);

    const result = await service.close('SS1');

    expect(gateAssignmentsService.deactivateForStage).toHaveBeenCalledWith(
      'SS1',
    );
    expect(result.status).toBe(StageStatus.CLOSED);
  });
});

describe('StagesService.activate', () => {
  it('delegates to GateAssignmentsService for a non-closed stage', async () => {
    const { service, gateAssignmentsService } = makeService([
      { id: 'SS1', status: StageStatus.NOT_STARTED },
    ]);

    const result = await service.activate('SS1', false);

    expect(gateAssignmentsService.activateForStage).toHaveBeenCalledWith(
      'SS1',
      false,
    );
    expect(result.status).toBe(StageStatus.ACTIVE);
  });

  it('refuses to reactivate a closed stage', async () => {
    const { service, gateAssignmentsService } = makeService([
      { id: 'SS1', status: StageStatus.CLOSED },
    ]);

    await expect(service.activate('SS1', false)).rejects.toThrow(/closed/i);
    expect(gateAssignmentsService.activateForStage).not.toHaveBeenCalled();
  });

  it('closes a bumped stage when forced, not just deactivates it', async () => {
    const { service, gateAssignmentsService, state } = makeService([
      { id: 'SS1', status: StageStatus.NOT_STARTED },
      { id: 'SS2', status: StageStatus.ACTIVE },
    ]);
    gateAssignmentsService.activateForStage.mockResolvedValue({
      assignments: [],
      deactivatedStageIds: ['SS2'],
    });

    await service.activate('SS1', true);

    expect(gateAssignmentsService.deactivateForStage).toHaveBeenCalledWith(
      'SS2',
    );
    expect(state).toMatchObject([
      { id: 'SS1', status: StageStatus.ACTIVE },
      { id: 'SS2', status: StageStatus.CLOSED },
    ]);
  });
});
