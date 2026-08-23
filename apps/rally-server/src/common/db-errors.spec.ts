import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { StageRun } from '../modules/stage-runs/stage-run.entity';
import { Vehicle } from '../modules/vehicles/vehicle.entity';
import { isUniqueViolation } from './db-errors';

/**
 * Driven by a *real* constraint violation rather than a hand-written Error.
 *
 * The whole job of `isUniqueViolation` is to recognise what the driver
 * actually throws, so asserting against a fabricated error only tests the
 * fabrication. Getting this wrong is quiet and expensive: a missed match
 * turns a 409 into a 500 on `POST /stage-runs` and `POST /vehicles`, and
 * makes `startRun` rethrow instead of recovering from a lost race.
 */
describe('isUniqueViolation', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Vehicle, StageRun],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('recognises a duplicate on a plain unique column', async () => {
    const vehicles = dataSource.getRepository(Vehicle);
    await vehicles.save(
      vehicles.create({ startNumber: '7', driverName: 'First' }),
    );

    const err = await vehicles
      .save(vehicles.create({ startNumber: '7', driverName: 'Second' }))
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).not.toBeNull();
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('recognises a duplicate on the partial unique index over surviving runs', async () => {
    // The index that enforces one non-voided attempt per vehicle+stage —
    // a different constraint kind, so worth pinning separately.
    const runs = dataSource.getRepository(StageRun);
    const base = {
      vehicleId: 'v1',
      stageId: 'SS1',
      startTime: new Date('2026-08-23T10:00:00.000Z'),
    };
    await runs.save(runs.create({ ...base, attempt: 1 }));

    const err = await runs.save(runs.create({ ...base, attempt: 2 })).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).not.toBeNull();
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('does not claim unrelated failures', async () => {
    const err = await dataSource.query('SELECT * FROM does_not_exist').then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).not.toBeNull();
    expect(isUniqueViolation(err)).toBe(false);
    expect(isUniqueViolation(new Error('something else went wrong'))).toBe(
      false,
    );
  });

  it('does not match an unrelated error that merely says "unique"', () => {
    // The old implementation regex-matched the message, so a message like
    // this was indistinguishable from a real constraint violation.
    expect(
      isUniqueViolation(new Error('could not build a unique gate id')),
    ).toBe(false);
  });
});
