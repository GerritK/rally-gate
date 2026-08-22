import { StageStatus } from '@rally-gate/shared';
import { FindOperator } from 'typeorm';
import { StagesService } from './stages.service';

type StageRow = {
  id: string;
  status: StageStatus;
  stageNumber?: number;
  name?: string;
};

function makeService(initialStages: StageRow[]) {
  const state: StageRow[] = initialStages.map((s) => ({ ...s }));
  const stages = {
    findOneBy: jest.fn(
      (
        where: Omit<Partial<StageRow>, 'id'> & {
          id?: string | FindOperator<string>;
        },
      ) => {
        const found = state.find((s) => {
          if ('id' in where && !(where.id instanceof FindOperator)) {
            return s.id === where.id;
          }
          if (
            where.stageNumber !== undefined &&
            s.stageNumber !== where.stageNumber
          ) {
            return false;
          }
          if (where.id instanceof FindOperator) {
            return s.id !== where.id.value;
          }
          return where.stageNumber !== undefined;
        });
        return Promise.resolve(found ? { ...found } : null);
      },
    ),
    save: jest.fn((s: StageRow) => {
      const idx = state.findIndex((row) => row.id === s.id);
      if (idx === -1) state.push({ ...s });
      else state[idx] = { ...s };
      return Promise.resolve({ ...s });
    }),
    delete: jest.fn((id: string) => {
      const idx = state.findIndex((row) => row.id === id);
      if (idx !== -1) state.splice(idx, 1);
      return Promise.resolve(undefined);
    }),
  };
  const gateAssignmentsService = {
    deactivateForStage: jest.fn().mockResolvedValue(undefined),
    activateForStage: jest.fn().mockResolvedValue({ deactivatedStageIds: [] }),
    removeForStage: jest.fn().mockResolvedValue(undefined),
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

describe('StagesService.create', () => {
  it('rejects a duplicate id instead of overwriting the existing stage', async () => {
    const { service } = makeService([
      {
        id: 'SS1',
        status: StageStatus.ACTIVE,
        stageNumber: 1,
        name: 'Stage 1',
      },
    ]);

    await expect(
      service.create({
        id: 'SS1',
        name: 'Different name',
        stageNumber: 2,
        status: StageStatus.NOT_STARTED,
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('rejects a stage number already used by another stage', async () => {
    const { service } = makeService([
      {
        id: 'SS1',
        status: StageStatus.NOT_STARTED,
        stageNumber: 1,
        name: 'Stage 1',
      },
    ]);

    await expect(
      service.create({
        id: 'SS2',
        name: 'Stage 2',
        stageNumber: 1,
        status: StageStatus.NOT_STARTED,
      }),
    ).rejects.toThrow(/stage number 1/i);
  });
});

describe('StagesService.update', () => {
  it('404s instead of silently creating a new stage', async () => {
    const { service } = makeService([]);

    await expect(
      service.update('SS1', {
        name: 'Stage 1',
        stageNumber: 1,
        status: StageStatus.NOT_STARTED,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a stage number clash with a different stage', async () => {
    const { service } = makeService([
      {
        id: 'SS1',
        status: StageStatus.NOT_STARTED,
        stageNumber: 1,
        name: 'Stage 1',
      },
      {
        id: 'SS2',
        status: StageStatus.NOT_STARTED,
        stageNumber: 2,
        name: 'Stage 2',
      },
    ]);

    await expect(
      service.update('SS2', {
        name: 'Stage 2',
        stageNumber: 1,
        status: StageStatus.NOT_STARTED,
      }),
    ).rejects.toThrow(/stage number 1/i);
  });

  it('allows saving a stage with its own unchanged stage number', async () => {
    const { service } = makeService([
      {
        id: 'SS1',
        status: StageStatus.NOT_STARTED,
        stageNumber: 1,
        name: 'Stage 1',
      },
    ]);

    const result = await service.update('SS1', {
      name: 'Renamed',
      stageNumber: 1,
      status: StageStatus.NOT_STARTED,
    });

    expect(result.name).toBe('Renamed');
  });
});

describe('StagesService.remove', () => {
  it('deletes a NOT_STARTED stage and its gate assignments', async () => {
    const { service, gateAssignmentsService, state } = makeService([
      { id: 'SS1', status: StageStatus.NOT_STARTED },
    ]);

    await service.remove('SS1');

    expect(gateAssignmentsService.removeForStage).toHaveBeenCalledWith('SS1');
    expect(state).toHaveLength(0);
  });

  it('refuses to delete a stage that has already started', async () => {
    const { service, gateAssignmentsService, state } = makeService([
      { id: 'SS1', status: StageStatus.ACTIVE },
    ]);

    await expect(service.remove('SS1')).rejects.toThrow(/NOT_STARTED/i);
    expect(gateAssignmentsService.removeForStage).not.toHaveBeenCalled();
    expect(state).toHaveLength(1);
  });

  it('404s for a missing stage', async () => {
    const { service } = makeService([]);

    await expect(service.remove('GHOST')).rejects.toThrow(/not found/i);
  });
});

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
