import 'reflect-metadata';
import { DataSource, getMetadataArgsStorage } from 'typeorm';
import { BetterSqlite3Driver } from 'typeorm/driver/better-sqlite3/BetterSqlite3Driver';
import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';

// Importing the entities is what registers their @Column decorators into
// TypeORM's global metadata storage — this file asserts on that storage, so
// every entity has to be pulled in here or its columns simply aren't checked.
import { DetectionEventRecord } from '../modules/events/detection-event.entity';
import { GateAssignment } from '../modules/gates/gate-assignment.entity';
import { Gate } from '../modules/gates/gate.entity';
import { RallyInfo } from '../modules/rally-info/rally-info.entity';
import { Setting } from '../modules/settings/setting.entity';
import { StageRun } from '../modules/stage-runs/stage-run.entity';
import { StageSplit } from '../modules/stage-runs/stage-split.entity';
import { Stage } from '../modules/stages/stage.entity';
import { Vehicle } from '../modules/vehicles/vehicle.entity';

const ENTITIES = [
  DetectionEventRecord,
  Gate,
  GateAssignment,
  RallyInfo,
  Setting,
  Stage,
  StageRun,
  StageSplit,
  Vehicle,
];

/**
 * `DB_TYPE=sqlite` and `DB_TYPE=postgres` run the *same* entities through two
 * drivers whose `supportedDataTypes` lists barely overlap, and TypeORM only
 * validates a column type at `DataSource.initialize()` — which calls
 * `driver.connect()` *before* `buildMetadatas()`. A Postgres-invalid type
 * therefore cannot fail until Postgres is actually reachable: never in the
 * default SQLite dev loop, and inside Docker only as a restart loop.
 *
 * This reproduces `EntityMetadataValidator`'s exact predicate
 * (`supportedDataTypes.includes(normalizeType(column))`) against both drivers
 * without needing either database running. It has caught, and exists to keep
 * catching, two failure modes documented in CLAUDE.md:
 *   - a driver-specific type: `'datetime'` (sqlite-only), `'timestamp'`
 *     (Postgres-only). `type: Date` is the portable spelling for timestamps.
 *   - a nullable column with no explicit `type:`, where reflect-metadata
 *     collapses `T | null` to `Object` and no driver accepts it.
 */
describe('entity column types', () => {
  // Constructing a driver never opens a connection — it only reads options and
  // loads the dialect package — so both can be inspected with no DB running.
  const drivers = {
    postgres: new PostgresDriver(new DataSource({ type: 'postgres' })),
    sqlite: new BetterSqlite3Driver(
      new DataSource({ type: 'better-sqlite3', database: ':memory:' }),
    ),
  };

  const columns = getMetadataArgsStorage()
    .columns.filter((column) =>
      ENTITIES.some((entity) => column.target === entity),
    )
    .map((column) => {
      const target = column.target as new () => object;
      return {
        entity: target.name,
        property: column.propertyName,
        // No explicit `type:` means TypeORM infers it from reflect-metadata,
        // which is exactly where the `T | null` -> Object collapse happens.
        type:
          column.options.type ??
          (Reflect.getMetadata(
            'design:type',
            target.prototype as object,
            column.propertyName,
          ) as unknown),
      };
    });

  it('finds every entity in the metadata storage', () => {
    // Guards against this whole suite silently passing on zero columns if an
    // entity is renamed/moved and its import above goes stale.
    expect(new Set(columns.map((c) => c.entity)).size).toBe(ENTITIES.length);
  });

  describe.each(Object.entries(drivers))('on %s', (_driverName, driver) => {
    it.each(columns)(
      '$entity.$property is a supported column type',
      ({ entity, property, type }) => {
        // Primary generated columns and relations carry no type of their own.
        if (type === undefined) return;
        const normalized = driver.normalizeType({ type } as never);
        expect({
          column: `${entity}.${property}`,
          declared: typeof type === 'function' ? type.name : type,
          normalized,
          supported: driver.supportedDataTypes.includes(normalized as never),
        }).toMatchObject({ supported: true });
      },
    );
  });
});
