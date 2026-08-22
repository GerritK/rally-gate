import {
  DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS,
  GatesService,
  measureClockOffsetMs,
} from './gates.service';

function makeService(opts: {
  existingGate?: unknown;
  autoDiscoverGates?: boolean;
  clockCorrectionThresholdMs?: number;
  removeAllForGate?: () => Promise<void>;
}) {
  const gates = {
    findOneBy: jest.fn().mockResolvedValue(opts.existingGate ?? null),
    create: jest.fn().mockImplementation((v: unknown) => v),
    save: jest.fn().mockImplementation((v: unknown) => Promise.resolve(v)),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const settingsService = {
    getBoolean: jest.fn().mockResolvedValue(opts.autoDiscoverGates ?? true),
    getNumber: jest
      .fn()
      .mockResolvedValue(
        opts.clockCorrectionThresholdMs ??
          DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS,
      ),
  };
  const emitter = { emit: jest.fn() };
  const gateAssignmentsService = {
    removeAllForGate: jest
      .fn()
      .mockImplementation(opts.removeAllForGate ?? (() => Promise.resolve())),
  };
  return {
    service: new GatesService(
      gates as never,
      settingsService as never,
      emitter as never,
      gateAssignmentsService as never,
    ),
    gates,
    gateAssignmentsService,
  };
}

describe('GatesService.recordHeartbeat', () => {
  it('auto-registers an unknown gate when auto-discovery is enabled (default)', async () => {
    const { service } = makeService({});

    const gate = await service.recordHeartbeat('GATE1');

    expect(gate).toMatchObject({ id: 'GATE1', name: 'GATE1' });
  });

  it('ignores an unknown gate when auto-discovery is disabled', async () => {
    const { service } = makeService({ autoDiscoverGates: false });

    const gate = await service.recordHeartbeat('GATE1');

    expect(gate).toBeNull();
  });

  it('still updates a previously known gate when auto-discovery is disabled', async () => {
    const { service } = makeService({
      existingGate: { id: 'GATE1', name: 'GATE1' },
      autoDiscoverGates: false,
    });

    const gate = await service.recordHeartbeat('GATE1', {
      capabilities: 'simulated',
    });

    expect(gate).toMatchObject({ id: 'GATE1', capabilities: 'simulated' });
  });

  it('records the clock offset from the heartbeat sentAt', async () => {
    const { service } = makeService({ existingGate: { id: 'GATE1' } });
    const arrivedAt = new Date('2026-01-01T12:00:04.000Z');

    // Gate stamped 12:00:00 but it arrived at 12:00:04 — its clock is 4s
    // behind, so +4000 is what brings its timestamps onto server time.
    const gate = await service.recordHeartbeat(
      'GATE1',
      { sentAt: '2026-01-01T12:00:00.000Z' },
      arrivedAt,
    );

    expect(gate?.clockOffsetMs).toBe(4_000);
  });

  it('leaves a previous offset alone when a heartbeat carries no sentAt', async () => {
    // An older gate-agent still counts as alive; "no measurement" must not
    // be confused with "measured zero".
    const { service } = makeService({
      existingGate: { id: 'GATE1', clockOffsetMs: 4_000 },
    });

    const gate = await service.recordHeartbeat('GATE1', {
      capabilities: 'simulated',
    });

    expect(gate?.clockOffsetMs).toBe(4_000);
  });
});

describe('measureClockOffsetMs', () => {
  const arrivedAt = new Date('2026-01-01T12:00:00.000Z');

  it('is negative when the gate clock runs ahead of the server', () => {
    expect(measureClockOffsetMs('2026-01-01T12:00:02.500Z', arrivedAt)).toBe(
      -2_500,
    );
  });

  it.each([
    ['missing', undefined],
    ['unparseable', 'yesterday-ish'],
  ])('returns null for a %s sentAt', (_label, sentAt) => {
    expect(measureClockOffsetMs(sentAt, arrivedAt)).toBeNull();
  });
});

describe('GatesService.clockCorrectionMsFor', () => {
  const gateWith = (clockOffsetMs?: number | null) =>
    ({ id: 'GATE1', name: 'GATE1', clockOffsetMs }) as never;

  it('applies an offset that clears the threshold', async () => {
    const { service } = makeService({});

    await expect(service.clockCorrectionMsFor(gateWith(4_000))).resolves.toBe(
      4_000,
    );
  });

  it('applies a negative offset that clears the threshold', async () => {
    const { service } = makeService({});

    await expect(service.clockCorrectionMsFor(gateWith(-4_000))).resolves.toBe(
      -4_000,
    );
  });

  it('ignores an offset inside the deadband', async () => {
    // 40ms is indistinguishable from transit time in a one-way measurement,
    // so "correcting" it would inject network jitter into a clock that may
    // be perfectly synced.
    const { service } = makeService({});

    await expect(service.clockCorrectionMsFor(gateWith(40))).resolves.toBe(0);
  });

  it('never corrects a gate that has no measurement yet', async () => {
    const { service } = makeService({});

    await expect(service.clockCorrectionMsFor(gateWith(null))).resolves.toBe(0);
    await expect(
      service.clockCorrectionMsFor(gateWith(undefined)),
    ).resolves.toBe(0);
  });

  it('honours a site-tuned threshold from settings', async () => {
    const { service } = makeService({ clockCorrectionThresholdMs: 25 });

    await expect(service.clockCorrectionMsFor(gateWith(40))).resolves.toBe(40);
  });
});

describe('GatesService.remove', () => {
  it('deletes the gate after cascading its assignments', async () => {
    const { service, gates, gateAssignmentsService } = makeService({});

    await service.remove('GATE1', true);

    expect(gateAssignmentsService.removeAllForGate).toHaveBeenCalledWith(
      'GATE1',
      true,
    );
    expect(gates.delete).toHaveBeenCalledWith('GATE1');
  });

  it('does not delete the gate when the assignment cascade refuses', async () => {
    const { service, gates } = makeService({
      removeAllForGate: () => Promise.reject(new Error('refused')),
    });

    await expect(service.remove('GATE1')).rejects.toThrow('refused');
    expect(gates.delete).not.toHaveBeenCalled();
  });
});
