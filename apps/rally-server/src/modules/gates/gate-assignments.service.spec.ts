import { ConflictException } from '@nestjs/common';
import { GateAssignmentsService } from './gate-assignments.service';

type Row = { id: string; gateId: string; stageId: string; active: boolean };

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const val = (row as never)[key];
    if (cond && typeof cond === 'object' && 'type' in cond) {
      const op = cond as { type: string; value: unknown };
      if (op.type === 'in') return (op.value as unknown[]).includes(val);
      if (op.type === 'not') return val !== op.value;
    }
    return val === cond;
  });
}

function makeService(rows: Row[]) {
  const state: Row[] = rows.map((r) => ({ ...r }));
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
  return { service: new GateAssignmentsService(repo as never), state };
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
