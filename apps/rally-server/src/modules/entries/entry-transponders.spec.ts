import 'reflect-metadata';
import { TransponderKind } from '@rally-gate/shared';
import { DataSource } from 'typeorm';
import { EntriesService } from './entries.service';
import { EntryClass } from './entry-class.entity';
import { EntryTransponder } from './entry-transponder.entity';
import { Entry } from './entry.entity';

/**
 * Against real sqlite, because both properties live in TypeORM rather than
 * our code: a replaced list must delete the rows it left out (not keep them
 * with a null entry), and a relation `where` must find every car carrying a
 * transponder, of its kind only.
 */
describe('entry transponders through sqlite', () => {
  let dataSource: DataSource;
  let service: EntriesService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Entry, EntryClass, EntryTransponder],
      synchronize: true,
    });
    await dataSource.initialize();
    service = new EntriesService(
      dataSource.getRepository(Entry),
      dataSource.getRepository(EntryClass),
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('replaces the list, deleting the transponders left out', async () => {
    const entry = await service.create({
      startNumber: 1,
      driverFirstName: 'A',
      transponders: [
        { kind: TransponderKind.RC, identifier: '111' },
        { kind: TransponderKind.RC, identifier: '222', label: 'spare car' },
      ],
    });

    const updated = await service.update(entry.id, {
      transponders: [{ kind: TransponderKind.NFC, identifier: '111' }],
    });

    expect(updated.transponders).toEqual([
      expect.objectContaining({ kind: TransponderKind.NFC, identifier: '111' }),
    ]);
    expect(await dataSource.getRepository(EntryTransponder).count()).toBe(1);
  });

  it('keeps the list when an update leaves it out', async () => {
    const entry = await service.create({
      startNumber: 2,
      driverFirstName: 'B',
      transponders: [{ kind: TransponderKind.RC, identifier: '333' }],
    });

    await service.update(entry.id, { driverFirstName: 'Bea' });

    expect((await service.findOne(entry.id))?.transponders).toHaveLength(1);
  });

  it('finds every car carrying a transponder, of its kind only', async () => {
    const [c, d] = await Promise.all(
      [3, 4].map((startNumber) =>
        service.create({
          startNumber,
          driverFirstName: 'C',
          transponders: [{ kind: TransponderKind.RC, identifier: '444' }],
        }),
      ),
    );
    await service.create({
      startNumber: 5,
      driverFirstName: 'E',
      transponders: [{ kind: TransponderKind.NFC, identifier: '444' }],
    });

    const found = await service.findByTransponder(TransponderKind.RC, '444');

    expect(found.map((e) => e.id).sort()).toEqual([c.id, d.id].sort());
  });
});
