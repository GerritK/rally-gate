import { GatesService } from './gates.service';

function makeService(opts: {
  existingGate?: unknown;
  autoDiscoverGates?: boolean;
}) {
  const gates = {
    findOneBy: jest.fn().mockResolvedValue(opts.existingGate ?? null),
    create: jest.fn().mockImplementation((v: unknown) => v),
    save: jest.fn().mockImplementation((v: unknown) => Promise.resolve(v)),
  };
  const settingsService = {
    getBoolean: jest.fn().mockResolvedValue(opts.autoDiscoverGates ?? true),
  };
  return new GatesService(gates as never, settingsService as never);
}

describe('GatesService.recordHeartbeat', () => {
  it('auto-registers an unknown gate when auto-discovery is enabled (default)', async () => {
    const service = makeService({});

    const gate = await service.recordHeartbeat('GATE1');

    expect(gate).toMatchObject({ id: 'GATE1', name: 'GATE1' });
  });

  it('ignores an unknown gate when auto-discovery is disabled', async () => {
    const service = makeService({ autoDiscoverGates: false });

    const gate = await service.recordHeartbeat('GATE1');

    expect(gate).toBeNull();
  });

  it('still updates a previously known gate when auto-discovery is disabled', async () => {
    const service = makeService({
      existingGate: { id: 'GATE1', name: 'GATE1' },
      autoDiscoverGates: false,
    });

    const gate = await service.recordHeartbeat('GATE1', 'simulated');

    expect(gate).toMatchObject({ id: 'GATE1', capabilities: 'simulated' });
  });
});
