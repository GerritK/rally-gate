import { StageRunStatus, StageStatus } from '@rally-gate/shared';
import { deriveStageRunStatus, StageRunsService } from './stage-runs.service';

describe('deriveStageRunStatus', () => {
  it('is FINISHED once a finishTime is set, regardless of stage closed', () => {
    const run = { finishTime: new Date() };
    expect(deriveStageRunStatus(run, false)).toBe(StageRunStatus.FINISHED);
    expect(deriveStageRunStatus(run, true)).toBe(StageRunStatus.FINISHED);
  });

  it('is STARTED when unfinished and the stage is still open', () => {
    expect(deriveStageRunStatus({ finishTime: undefined }, false)).toBe(
      StageRunStatus.STARTED,
    );
  });

  it('is CANCELLED when unfinished and the stage has been closed', () => {
    expect(deriveStageRunStatus({ finishTime: undefined }, true)).toBe(
      StageRunStatus.CANCELLED,
    );
  });
});

function makeService(
  run: Record<string, unknown> | null,
  stage: { status: StageStatus } = { status: StageStatus.NOT_STARTED },
) {
  const stageRuns = {
    findOneBy: jest.fn().mockResolvedValue(run),
    save: jest.fn().mockImplementation((r) => Promise.resolve(r)),
    delete: jest.fn().mockResolvedValue({ affected: run ? 1 : 0 }),
  };
  const stageSplits = {};
  const stagesService = { findOne: jest.fn().mockResolvedValue(stage) };
  const emitter = { emit: jest.fn() };
  const service = new StageRunsService(
    stageRuns as never,
    stageSplits as never,
    stagesService as never,
    emitter as never,
  );
  return { service, stageRuns, emitter };
}

describe('StageRunsService.correctRun', () => {
  const baseRun = {
    id: 'r1',
    vehicleId: 'v1',
    stageId: 's1',
    startTime: new Date('2026-01-01T00:00:00.000Z'),
    finishTime: new Date('2026-01-01T00:01:00.000Z'),
    durationMs: 60_000,
  };

  it('recomputes durationMs from the corrected finish time', async () => {
    const { service, emitter } = makeService({ ...baseRun });

    const corrected = await service.correctRun('r1', {
      finishTime: '2026-01-01T00:01:30.000Z',
    });

    expect(corrected.durationMs).toBe(90_000);
    expect(corrected.status).toBe(StageRunStatus.FINISHED);
    expect(emitter.emit).toHaveBeenCalledWith('stage-run.updated', corrected);
  });

  it('reports STARTED when finishTime is cleared and the stage is open', async () => {
    const { service } = makeService(
      { ...baseRun },
      { status: StageStatus.NOT_STARTED },
    );

    const corrected = await service.correctRun('r1', { finishTime: null });

    // Must be null, not undefined: TypeORM's save() silently skips
    // undefined properties (leaves the DB column untouched), so only null
    // actually clears finishTime — see the entity's doc comment.
    expect(corrected.finishTime).toBeNull();
    expect(corrected.durationMs).toBeNull();
    expect(corrected.status).toBe(StageRunStatus.STARTED);
  });

  it('reports CANCELLED when finishTime is cleared and the stage is closed', async () => {
    const { service } = makeService(
      { ...baseRun },
      { status: StageStatus.CLOSED },
    );

    const corrected = await service.correctRun('r1', { finishTime: null });

    expect(corrected.status).toBe(StageRunStatus.CANCELLED);
  });

  it('throws NotFoundException for a missing run', async () => {
    const { service } = makeService(null);
    await expect(service.correctRun('missing', {})).rejects.toThrow(
      'StageRun missing not found',
    );
  });
});

describe('StageRunsService.createManual', () => {
  it('throws ConflictException when the vehicle already has a run on the stage', async () => {
    const stageRuns = {
      create: jest.fn().mockImplementation((r: unknown) => r),
      save: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'UNIQUE constraint failed: stage_run.vehicleId, stage_run.stageId',
          ),
        ),
    };
    const stagesService = { findOne: jest.fn() };
    const emitter = { emit: jest.fn() };
    const service = new StageRunsService(
      stageRuns as never,
      {} as never,
      stagesService as never,
      emitter as never,
    );

    await expect(
      service.createManual({
        vehicleId: 'v1',
        stageId: 's1',
        startTime: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('Vehicle v1 already has a run on stage s1');
  });
});

describe('StageRunsService.startRun', () => {
  it('falls back to the existing row when it loses a race on the unique constraint', async () => {
    const existing = {
      id: 'r1',
      vehicleId: 'v1',
      stageId: 's1',
      startTime: new Date('2026-01-01T00:00:00.000Z'),
      finishTime: undefined,
    };
    const stageRuns = {
      findOneBy: jest
        .fn()
        .mockResolvedValueOnce(null) // findActive pre-check
        .mockResolvedValueOnce(null) // findFinished pre-check
        .mockResolvedValueOnce(existing), // findActive after losing the race
      create: jest.fn().mockImplementation((r: unknown) => r),
      save: jest.fn().mockRejectedValue(new Error('UNIQUE constraint failed')),
    };
    const stagesService = {
      findOne: jest.fn().mockResolvedValue({ status: StageStatus.NOT_STARTED }),
    };
    const service = new StageRunsService(
      stageRuns as never,
      {} as never,
      stagesService as never,
      { emit: jest.fn() } as never,
    );

    const result = await service.startRun(
      'v1',
      's1',
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.id).toBe('r1');
    expect(result.status).toBe(StageRunStatus.STARTED);
  });
});
