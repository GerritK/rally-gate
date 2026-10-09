import { NotFoundException } from '@nestjs/common';
import { EntryStatus } from '@rally-gate/shared';
import { EntriesService } from './entries.service';

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

function makeService(saveImpl: (v: unknown) => Promise<unknown>) {
  const entries = {
    create: jest.fn().mockImplementation((v: unknown) => v),
    save: jest.fn().mockImplementation(saveImpl),
  };
  return new EntriesService(entries as never, {} as never);
}

describe('EntriesService.create', () => {
  it('throws ConflictException when the start number is already taken', async () => {
    const service = makeService(() => Promise.reject(uniqueViolation()));

    await expect(
      service.create({ startNumber: 12, driverFirstName: 'Demo' }),
    ).rejects.toThrow('Start number 12 is already in use');
  });

  it('passes through other errors unchanged', async () => {
    const service = makeService(() => Promise.reject(new Error('disk full')));

    await expect(
      service.create({ startNumber: 12, driverFirstName: 'Demo' }),
    ).rejects.toThrow('disk full');
  });

  it('returns the saved entry on success', async () => {
    const saved = { id: 'v1', startNumber: 12, driverFirstName: 'Demo' };
    const service = makeService(() => Promise.resolve(saved));

    await expect(
      service.create({ startNumber: 12, driverFirstName: 'Demo' }),
    ).resolves.toEqual(saved);
  });
});

describe('EntriesService.findAllClasses', () => {
  it('lists main classes first, each group alphabetical regardless of case', async () => {
    const classes = {
      find: jest.fn().mockResolvedValue([
        { name: 'stock', main: false },
        { name: '10WD', main: true },
        { name: 'Rookie', main: false },
        { name: '2WD', main: true },
      ]),
    };
    const service = new EntriesService({} as never, classes as never);

    const names = (await service.findAllClasses()).map((c) => c.name);

    expect(names).toEqual(['2WD', '10WD', 'Rookie', 'stock']);
  });
});

function makeServiceForUpdate(
  existingEntry: unknown,
  saveImpl: (v: unknown) => Promise<unknown> = (v) => Promise.resolve(v),
) {
  const entries = {
    findOneBy: jest.fn().mockResolvedValue(existingEntry),
    save: jest.fn().mockImplementation(saveImpl),
  };
  return new EntriesService(entries as never, {} as never);
}

describe('EntriesService.update', () => {
  it('throws NotFoundException for an unknown entry', async () => {
    const service = makeServiceForUpdate(null);

    await expect(
      service.update('missing', { status: EntryStatus.CHECKED_IN }),
    ).rejects.toThrow(NotFoundException);
  });

  it('merges the patch onto the existing entry and saves it', async () => {
    const service = makeServiceForUpdate({
      id: 'v1',
      startNumber: 12,
      driverFirstName: 'Demo',
      status: EntryStatus.REGISTERED,
    });

    const updated = await service.update('v1', {
      status: EntryStatus.CHECKED_IN,
      coDriverFirstName: 'Co Driver',
    });

    expect(updated).toMatchObject({
      startNumber: 12,
      driverFirstName: 'Demo',
      status: EntryStatus.CHECKED_IN,
      coDriverFirstName: 'Co Driver',
    });
  });

  it('keeps fields the patch carries as undefined, as a validated DTO does', async () => {
    const service = makeServiceForUpdate({
      id: 'v1',
      startNumber: 12,
      driverFirstName: 'Demo',
      coDriverFirstName: 'Co',
    });

    const updated = await service.update('v1', {
      startNumber: undefined,
      driverFirstName: undefined,
      coDriverFirstName: null,
      status: EntryStatus.CHECKED_IN,
    });

    expect(updated).toMatchObject({
      startNumber: 12,
      driverFirstName: 'Demo',
      coDriverFirstName: null,
      status: EntryStatus.CHECKED_IN,
    });
  });

  it('throws ConflictException when the new start number is already taken', async () => {
    const service = makeServiceForUpdate(
      { id: 'v1', startNumber: 12, driverFirstName: 'Demo' },
      () => Promise.reject(uniqueViolation()),
    );

    await expect(service.update('v1', { startNumber: 99 })).rejects.toThrow(
      'Start number 99 is already in use',
    );
  });
});
