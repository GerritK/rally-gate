import { StageRunStatus, StageStatus } from '@rally-gate/shared';
import type { StageRun } from './stage-run.entity';
import {
  deriveStageRunStatus,
  latestAttempts,
  StageRunsService,
} from './stage-runs.service';

/**
 * Shaped like what the sqlite driver actually throws — the code is what
 * `isUniqueViolation` matches on. `db-errors.spec.ts` pins that against a
 * real constraint violation; this is only a stand-in for the service tests.
 */
function uniqueViolation(): Error {
  return Object.assign(new Error('UNIQUE constraint failed'), {
    code: 'SQLITE_CONSTRAINT_UNIQUE',
  });
}

describe('latestAttempts', () => {
  const run = (
    vehicleId: string,
    stageId: string,
    attempt: number,
    durationMs: number,
  ) =>
    ({
      vehicleId,
      stageId,
      attempt,
      durationMs,
    }) as StageRun;

  it('keeps only the most recent attempt per vehicle and stage', () => {
    // A red-flagged stage gets re-run; the first attempt stays in the
    // database as evidence but must not compete with the re-run.
    const first = run('v1', 'SS1', 1, 90_000);
    const rerun = run('v1', 'SS1', 2, 120_000);

    expect(latestAttempts([first, rerun])).toEqual([rerun]);
  });

  it('picks the re-run even when it is the slower time', () => {
    // "Latest", not "best" — a re-run replaces the original outright, so a
    // crew cannot keep a quicker voided run by being slower second time.
    const quickVoided = run('v1', 'SS1', 1, 60_000);
    const slowRerun = run('v1', 'SS1', 2, 200_000);

    expect(latestAttempts([slowRerun, quickVoided])).toEqual([slowRerun]);
  });

  it('ignores a voided attempt so results fall back to the surviving one', () => {
    const original = run('v1', 'SS1', 1, 90_000);
    const voidedRerun = { ...run('v1', 'SS1', 2, 120_000), voided: true };

    expect(latestAttempts([original, voidedRerun])).toEqual([original]);
  });

  it('yields no result at all when every attempt is voided', () => {
    // The correct reading of "that run didn't happen" — the vehicle should
    // drop out of the stage's results rather than keep a struck-out time.
    const only = { ...run('v1', 'SS1', 1, 90_000), voided: true };

    expect(latestAttempts([only])).toEqual([]);
  });

  it('keeps attempts on different stages and by different vehicles apart', () => {
    const a = run('v1', 'SS1', 1, 90_000);
    const b = run('v1', 'SS2', 1, 95_000);
    const c = run('v2', 'SS1', 1, 88_000);

    expect(latestAttempts([a, b, c])).toHaveLength(3);
  });
});

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

  it('is VOIDED ahead of FINISHED, even with a finish time recorded', () => {
    // Order matters: a voided run usually *does* have a finishTime, and
    // reporting FINISHED would present a struck-out time as a result.
    const run = { finishTime: new Date(), voided: true };
    expect(deriveStageRunStatus(run, false)).toBe(StageRunStatus.VOIDED);
    expect(deriveStageRunStatus(run, true)).toBe(StageRunStatus.VOIDED);
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

describe('StageRunsService.findSplitsForStageAtIndex', () => {
  it('drops a voided attempt so its splits leave the live leaderboard', async () => {
    // Regression: this queried the repository directly instead of going
    // through findByStage, so it never applied latestAttempts and a voided
    // attempt's split times kept showing on the split classification.
    const surviving = {
      id: 'r2',
      vehicleId: 'v1',
      stageId: 's1',
      attempt: 2,
      voided: false,
      finishTime: new Date(),
    };
    const voided = {
      id: 'r1',
      vehicleId: 'v1',
      stageId: 's1',
      attempt: 1,
      voided: true,
      finishTime: new Date(),
    };
    const stageRuns = {
      find: jest.fn().mockResolvedValue([voided, surviving]),
    };
    const stageSplits = {
      find: jest.fn().mockResolvedValue([
        { id: 's-voided', stageRunId: 'r1', splitIndex: 1, elapsedMs: 1_000 },
        { id: 's-live', stageRunId: 'r2', splitIndex: 1, elapsedMs: 2_000 },
      ]),
    };
    const service = new StageRunsService(
      stageRuns as never,
      stageSplits as never,
      {
        findOne: jest.fn().mockResolvedValue({ status: StageStatus.ACTIVE }),
      } as never,
      { emit: jest.fn() } as never,
    );

    const pairs = await service.findSplitsForStageAtIndex('s1', 1);

    expect(pairs.map((p) => p.split.id)).toEqual(['s-live']);
  });
});

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

  it('rejects a finish time at or before the start time', async () => {
    const { service, stageRuns } = makeService({ ...baseRun });

    await expect(
      service.correctRun('r1', { finishTime: '2025-12-31T23:59:00.000Z' }),
    ).rejects.toThrow('must be after startTime');
    expect(stageRuns.save).not.toHaveBeenCalled();
  });

  it('rejects a start time moved past an existing finish time', async () => {
    // Only startTime is patched here — the pair still has to end up ordered,
    // so the check runs against the merged run, not just the patch.
    const { service } = makeService({ ...baseRun });

    await expect(
      service.correctRun('r1', { startTime: '2026-01-01T00:02:00.000Z' }),
    ).rejects.toThrow('must be after startTime');
  });

  it('rejects an unparseable date instead of storing NaN', async () => {
    const { service, stageRuns } = makeService({ ...baseRun });

    await expect(
      service.correctRun('r1', { finishTime: 'yesterday-ish' }),
    ).rejects.toThrow('finishTime is not a valid date/time');
    expect(stageRuns.save).not.toHaveBeenCalled();
  });
});

describe('StageRunsService.unvoidRun', () => {
  const voidedRun = {
    id: 'r1',
    vehicleId: 'v1',
    stageId: 's1',
    attempt: 1,
    voided: true,
    startTime: new Date('2026-01-01T00:00:00.000Z'),
    finishTime: new Date('2026-01-01T00:01:30.000Z'),
  };

  function makeUnvoidService(siblings: Record<string, unknown>[]) {
    const stageRuns = {
      findOneBy: jest.fn().mockResolvedValue({ ...voidedRun }),
      // The service filters itself out, so return it alongside the siblings
      // exactly as the repository would.
      find: jest.fn().mockResolvedValue(siblings),
      save: jest.fn().mockImplementation((r) => Promise.resolve(r)),
    };
    const stagesService = {
      findOne: jest.fn().mockResolvedValue({ status: StageStatus.NOT_STARTED }),
    };
    return {
      service: new StageRunsService(
        stageRuns as never,
        {} as never,
        stagesService as never,
        { emit: jest.fn() } as never,
      ),
      stageRuns,
    };
  }

  it('restores a void when nothing else survives on that stage', async () => {
    const { service } = makeUnvoidService([]);

    const restored = await service.unvoidRun('r1');

    expect(restored.voided).toBe(false);
    expect(restored.status).toBe(StageRunStatus.FINISHED);
  });

  // One rule covers every shape of "something else already counts", because
  // there is one invariant: at most one non-voided attempt per vehicle+stage.
  it.each([
    ['a higher attempt survives', { id: 'r2', attempt: 2 }],
    ['a lower attempt survives', { id: 'r0', attempt: 0 }],
  ])('refuses when %s', async (_label, survivor) => {
    const { service, stageRuns } = makeUnvoidService([
      { ...survivor, voided: false, finishTime: new Date() },
    ]);

    await expect(service.unvoidRun('r1')).rejects.toThrow(
      `Attempt ${survivor.attempt} already counts`,
    );
    expect(stageRuns.save).not.toHaveBeenCalled();
  });

  it('refuses rather than cascading a void onto the surviving run', async () => {
    // The whole point: striking out a run the car actually drove is the
    // marshal's call to make explicitly, not a side effect of "restore".
    const { service, stageRuns } = makeUnvoidService([
      { id: 'r2', attempt: 2, voided: false, finishTime: new Date() },
    ]);

    await expect(service.unvoidRun('r1')).rejects.toThrow();
    // Nothing was written at all — the survivor is untouched.
    expect(stageRuns.save).not.toHaveBeenCalled();
  });
});

describe('StageRunsService.createManual', () => {
  it('throws ConflictException when the vehicle already has an unfinished run', async () => {
    const stageRuns = {
      findOne: jest.fn().mockResolvedValue(null), // nextAttempt lookup
      create: jest.fn().mockImplementation((r: unknown) => r),
      save: jest.fn().mockRejectedValue(uniqueViolation()),
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
      // A vehicle has at most one non-voided attempt per stage, so recording
      // a re-run by hand means voiding the previous attempt first.
    ).rejects.toThrow('already has an attempt on stage s1 that counts');
  });

  it('rejects a finish time at or before the start time', async () => {
    const { service, stageRuns } = makeService(null);

    await expect(
      service.createManual({
        vehicleId: 'v1',
        stageId: 's1',
        startTime: '2026-01-01T00:01:00.000Z',
        finishTime: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('must be after startTime');
    expect(stageRuns.save).not.toHaveBeenCalled();
  });
});

describe('StageRunsService.finishRun', () => {
  const activeRun = {
    id: 'r1',
    vehicleId: 'v1',
    stageId: 's1',
    startTime: new Date('2026-01-01T00:00:00.000Z'),
    finishTime: null,
  };

  it('records a finish after the start normally', async () => {
    const { service } = makeService({ ...activeRun });

    const finished = await service.finishRun(
      'v1',
      's1',
      new Date('2026-01-01T00:01:00.000Z'),
    );

    expect(finished?.durationMs).toBe(60_000);
  });

  it('ignores a finish before the start rather than storing a negative duration', async () => {
    // The classic clock-skew case: the finish gate's Pi is behind the start
    // gate's. Ranking sorts durationMs ascending, so persisting this would
    // silently put the car first.
    const { service, stageRuns } = makeService({ ...activeRun });

    const finished = await service.finishRun(
      'v1',
      's1',
      new Date('2025-12-31T23:59:00.000Z'),
    );

    expect(finished).toBeNull();
    expect(stageRuns.save).not.toHaveBeenCalled();
  });
});

describe('StageRunsService.startRun', () => {
  it('falls back to the existing row when it loses a race on the unique index', async () => {
    // Two detections for the same passing can both clear the findActive
    // check; the partial unique index on unfinished runs is what stops the
    // second one becoming a duplicate row.
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
        .mockResolvedValueOnce(existing), // findActive after losing the race
      findOne: jest.fn().mockResolvedValue(null), // findFinished pre-check
      create: jest.fn().mockImplementation((r: unknown) => r),
      save: jest.fn().mockRejectedValue(uniqueViolation()),
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
