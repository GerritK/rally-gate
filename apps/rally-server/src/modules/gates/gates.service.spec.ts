import { GatesService } from './gates.service';

function makeService(opts: {
  existingGate?: unknown;
  autoDiscoverGates?: boolean;
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

    const gate = await service.recordHeartbeat('GATE1', 'simulated');

    expect(gate).toMatchObject({ id: 'GATE1', capabilities: 'simulated' });
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
