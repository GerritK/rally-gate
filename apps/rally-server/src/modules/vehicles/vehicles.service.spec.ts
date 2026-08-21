import { VehiclesService } from './vehicles.service';

function makeService(saveImpl: (v: unknown) => Promise<unknown>) {
  const vehicles = {
    create: jest.fn().mockImplementation((v: unknown) => v),
    save: jest.fn().mockImplementation(saveImpl),
  };
  return new VehiclesService(vehicles as never);
}

describe('VehiclesService.create', () => {
  it('throws ConflictException when the start number is already taken', async () => {
    const service = makeService(() =>
      Promise.reject(
        new Error(
          'SQLITE_CONSTRAINT: UNIQUE constraint failed: vehicle.startNumber',
        ),
      ),
    );

    await expect(
      service.create({ startNumber: '12', driverName: 'Demo' }),
    ).rejects.toThrow('Start number 12 is already in use');
  });

  it('passes through other errors unchanged', async () => {
    const service = makeService(() => Promise.reject(new Error('disk full')));

    await expect(
      service.create({ startNumber: '12', driverName: 'Demo' }),
    ).rejects.toThrow('disk full');
  });

  it('returns the saved vehicle on success', async () => {
    const saved = { id: 'v1', startNumber: '12', driverName: 'Demo' };
    const service = makeService(() => Promise.resolve(saved));

    await expect(
      service.create({ startNumber: '12', driverName: 'Demo' }),
    ).resolves.toEqual(saved);
  });
});
