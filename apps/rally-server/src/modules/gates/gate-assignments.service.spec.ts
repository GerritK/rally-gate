import { ConflictException } from '@nestjs/common';
import { StageStatus } from '@rally-gate/shared';
import { GateAssignmentsService } from './gate-assignments.service';

type Row = { id: string; gateId: string; stageId: string; active: boolean };
type StageRow = { id: string; status: StageStatus };

function matches(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const val = row[key];
    if (cond && typeof cond === 'object' && 'type' in cond) {
      const op = cond as { type: string; value: unknown };
      if (op.type === 'in') return (op.value as unknown[]).includes(val);
      if (op.type === 'not') return val !== op.value;
    }
    return val === cond;
  });
}

function makeService(
  rows: Row[],
  stageRows: StageRow[] = [{ id: 'SS1', status: StageStatus.NOT_STARTED }],
) {
  const state: Row[] = rows.map((r) => ({ ...r }));
  const stageState: StageRow[] = stageRows.map((s) => ({ ...s }));
  const find = jest.fn((opts?: { where?: Record<string, unknown> }) =>
    Promise.resolve(state.filter((r) => matches(r, opts?.where ?? {}))),
  );
  const applyUpdate = (where: Record<string, unknown>, patch: Partial<Row>) => {
    state.forEach((r) => {
      if (matches(r, where)) Object.assign(r, patch);
    });
  };
  const repo = {
    find,
    create: jest.fn((data: Omit<Row, 'id'>) => ({
      id: `a${state.length + 1}`,
      ...data,
    })),
    save: jest.fn((row: Row) => {
      state.push(row);
      return Promise.resolve(row);
    }),
    findOneBy: jest.fn((where: Record<string, unknown>) =>
      Promise.resolve(state.find((r) => matches(r, where)) ?? null),
    ),
    delete: jest.fn((idOrWhere: string | Record<string, unknown>) => {
      const where =
        typeof idOrWhere === 'string' ? { id: idOrWhere } : idOrWhere;
      for (let i = state.length - 1; i >= 0; i--) {
        if (matches(state[i], where)) state.splice(i, 1);
      }
      return Promise.resolve();
    }),
    update: jest.fn((where: Record<string, unknown>, patch: Partial<Row>) => {
      applyUpdate(where, patch);
      return Promise.resolve();
    }),
    manager: {
      transaction: jest.fn(async (cb: (manager: unknown) => Promise<void>) =>
        cb({
          update: (
            _entity: unknown,
            where: Record<string, unknown>,
            patch: Partial<Row>,
          ) => Promise.resolve(applyUpdate(where, patch)),
        }),
      ),
    },
  };
  const stagesRepo = {
    findOneBy: jest.fn((where: Record<string, unknown>) =>
      Promise.resolve(stageState.find((s) => matches(s, where)) ?? null),
    ),
    find: jest.fn((opts?: { where?: Record<string, unknown> }) =>
      Promise.resolve(stageState.filter((s) => matches(s, opts?.where ?? {}))),
    ),
  };
  return {
    service: new GateAssignmentsService(repo as never, stagesRepo as never),
    state,
  };
}

describe('GateAssignmentsService.activateForStage', () => {
  it('activates a stage with no gate conflicts', async () => {
    const { service, state } = makeService([
      { id: 'a1', gateId: 'G1', stageId: 'SS1', active: false },
    ]);

    const result = await service.activateForStage('SS1');

    expect(result.deactivatedStageIds).toEqual([]);
    expect(state[0].active).toBe(true);
  });

  it('refuses when another stage is active on a shared gate', async () => {
    const { service } = makeService([
      { id: 'a1', gateId: 'G1', stageId: 'SS1', active: false },
      { id: 'a2', gateId: 'G1', stageId: 'SS2', active: true },
    ]);

    await expect(service.activateForStage('SS1')).rejects.toMatchObject(
      new ConflictException({ conflictingStageIds: ['SS2'] }),
    );
  });

  it('deactivates the conflicting stage when forced', async () => {
    const { service, state } = makeService([
      { id: 'a1', gateId: 'G1', stageId: 'SS1', active: false },
      { id: 'a2', gateId: 'G1', stageId: 'SS2', active: true },
    ]);

    const result = await service.activateForStage('SS1', true);

    expect(result.deactivatedStageIds).toEqual(['SS2']);
    expect(state).toMatchObject([
      { id: 'a1', stageId: 'SS1', active: true },
      { id: 'a2', stageId: 'SS2', active: false },
    ]);
  });
});

describe('GateAssignmentsService.create', () => {
  it('creates an assignment for a NOT_STARTED stage', async () => {
    const { service, state } = makeService(
      [],
      [{ id: 'SS1', status: StageStatus.NOT_STARTED }],
    );

    await service.create({
      gateId: 'G1',
      stageId: 'SS1',
      role: 'stage_start' as never,
    });

    expect(state).toHaveLength(1);
  });

  it.each([StageStatus.ACTIVE, StageStatus.CLOSED])(
    'refuses to add an assignment to a %s stage',
    async (status) => {
      const { service, state } = makeService([], [{ id: 'SS1', status }]);

      await expect(
        service.create({
          gateId: 'G1',
          stageId: 'SS1',
          role: 'stage_start' as never,
        }),
      ).rejects.toThrow(/NOT_STARTED/i);
      expect(state).toHaveLength(0);
    },
  );
});

describe('GateAssignmentsService.remove', () => {
  it('removes an assignment belonging to a NOT_STARTED stage', async () => {
    const { service, state } = makeService(
      [{ id: 'a1', gateId: 'G1', stageId: 'SS1', active: false }],
      [{ id: 'SS1', status: StageStatus.NOT_STARTED }],
    );

    await service.remove('a1');

    expect(state).toHaveLength(0);
  });

  it.each([StageStatus.ACTIVE, StageStatus.CLOSED])(
    'refuses to remove an assignment from a %s stage',
    async (status) => {
      const { service, state } = makeService(
        [{ id: 'a1', gateId: 'G1', stageId: 'SS1', active: true }],
        [{ id: 'SS1', status }],
      );

      await expect(service.remove('a1')).rejects.toThrow(/NOT_STARTED/i);
      expect(state).toHaveLength(1);
    },
  );

  it('no-ops for an assignment that no longer exists', async () => {
    const { service } = makeService([]);

    await expect(service.remove('ghost')).resolves.toBeUndefined();
  });
});

describe('GateAssignmentsService.removeAllForGate', () => {
  it('no-ops for a gate with no assignments', async () => {
    const { service, state } = makeService([]);

    await expect(service.removeAllForGate('G1')).resolves.toBeUndefined();
    expect(state).toHaveLength(0);
  });

  it('refuses without force when the gate has NOT_STARTED-stage assignments', async () => {
    const { service, state } = makeService(
      [{ id: 'a1', gateId: 'G1', stageId: 'SS1', active: false }],
      [{ id: 'SS1', status: StageStatus.NOT_STARTED }],
    );

    await expect(service.removeAllForGate('G1')).rejects.toThrow(/assignment/i);
    expect(state).toHaveLength(1);
  });

  it('cascades when forced', async () => {
    const { service, state } = makeService(
      [
        { id: 'a1', gateId: 'G1', stageId: 'SS1', active: false },
        { id: 'a2', gateId: 'G1', stageId: 'SS2', active: false },
        { id: 'a3', gateId: 'G2', stageId: 'SS1', active: false },
      ],
      [
        { id: 'SS1', status: StageStatus.NOT_STARTED },
        { id: 'SS2', status: StageStatus.NOT_STARTED },
      ],
    );

    await service.removeAllForGate('G1', true);

    expect(state).toEqual([
      { id: 'a3', gateId: 'G2', stageId: 'SS1', active: false },
    ]);
  });

  it.each([StageStatus.ACTIVE, StageStatus.CLOSED])(
    'refuses even with force when a referenced stage is %s',
    async (status) => {
      const { service, state } = makeService(
        [{ id: 'a1', gateId: 'G1', stageId: 'SS1', active: true }],
        [{ id: 'SS1', status }],
      );

      await expect(service.removeAllForGate('G1', true)).rejects.toThrow(
        /ACTIVE\/CLOSED/i,
      );
      expect(state).toHaveLength(1);
    },
  );
});
