import { NotFoundException } from '@nestjs/common';
import { VehicleStatus } from '@rally-gate/shared';
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

function makeServiceForUpdate(
  existingVehicle: unknown,
  saveImpl: (v: unknown) => Promise<unknown> = (v) => Promise.resolve(v),
) {
  const vehicles = {
    findOneBy: jest.fn().mockResolvedValue(existingVehicle),
    save: jest.fn().mockImplementation(saveImpl),
  };
  return new VehiclesService(vehicles as never);
}

describe('VehiclesService.update', () => {
  it('throws NotFoundException for an unknown vehicle', async () => {
    const service = makeServiceForUpdate(null);

    await expect(
      service.update('missing', { status: VehicleStatus.CHECKED_IN }),
    ).rejects.toThrow(NotFoundException);
  });

  it('merges the patch onto the existing vehicle and saves it', async () => {
    const service = makeServiceForUpdate({
      id: 'v1',
      startNumber: '12',
      driverName: 'Demo',
      status: VehicleStatus.REGISTERED,
    });

    const updated = await service.update('v1', {
      status: VehicleStatus.CHECKED_IN,
      coDriverName: 'Co Driver',
    });

    expect(updated).toMatchObject({
      startNumber: '12',
      driverName: 'Demo',
      status: VehicleStatus.CHECKED_IN,
      coDriverName: 'Co Driver',
    });
  });

  it('throws ConflictException when the new start number is already taken', async () => {
    const service = makeServiceForUpdate(
      { id: 'v1', startNumber: '12', driverName: 'Demo' },
      () =>
        Promise.reject(
          new Error(
            'SQLITE_CONSTRAINT: UNIQUE constraint failed: vehicle.startNumber',
          ),
        ),
    );

    await expect(service.update('v1', { startNumber: '99' })).rejects.toThrow(
      'Start number 99 is already in use',
    );
  });
});
