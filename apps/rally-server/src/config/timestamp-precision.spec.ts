import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DetectionEventRecord } from '../modules/events/detection-event.entity';
import { StageRun } from '../modules/stage-runs/stage-run.entity';
import { StageSplit } from '../modules/stage-runs/stage-split.entity';

/**
 * Sub-second precision survives a round trip through the database.
 *
 * This is the product's core property — RC rally margins are tenths of a
 * second — and it is the one thing a mocked repository structurally cannot
 * check, because the risk lives entirely in how the driver serialises a
 * `Date`. A regression here would not throw; every stage time would just
 * quietly quantise, and the results would stay plausible while being wrong.
 *
 * Worth pinning because a neighbouring case genuinely does truncate:
 * `@CreateDateColumn` writes second precision on sqlite, which is what made
 * an earlier attempt at ordering re-runs by creation time tie. The column
 * *type* is not the culprit — on the same `datetime` type, an
 * application-set `Date` stores `10:00:00.123` while `@CreateDateColumn`
 * stores `00:07:54`. Easy to get backwards, and alarming if you do, since
 * it reads as "our stage times are second-precision".
 *
 * Runs against in-memory sqlite: `DB_TYPE=postgres` uses `timestamp`, which
 * carries microseconds, so sqlite is the tighter of the two.
 */
describe('timestamp precision through sqlite', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [StageRun, StageSplit, DetectionEventRecord],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('preserves milliseconds on a stage run, so a duration is not quantised', async () => {
    const runs = dataSource.getRepository(StageRun);
    const startTime = new Date('2026-08-23T10:00:00.123Z');
    const finishTime = new Date('2026-08-23T10:01:30.456Z');

    const saved = await runs.save(
      runs.create({
        vehicleId: 'v1',
        stageId: 'SS1',
        attempt: 1,
        startTime,
        finishTime,
        durationMs: finishTime.getTime() - startTime.getTime(),
      }),
    );
    const loaded = await runs.findOneByOrFail({ id: saved.id });

    expect(loaded.startTime.toISOString()).toBe(startTime.toISOString());
    expect(loaded.finishTime?.toISOString()).toBe(finishTime.toISOString());
    // Recomputed from what came back, not from what went in — a truncating
    // driver would round this to 90_000 while the stored durationMs stayed
    // correct, hiding the loss.
    expect(
      (loaded.finishTime as Date).getTime() - loaded.startTime.getTime(),
    ).toBe(90_333);
  });

  it('separates two runs a tenth of a second apart', async () => {
    // The margin that actually decides an RC rally result.
    const runs = dataSource.getRepository(StageRun);
    const start = new Date('2026-08-23T11:00:00.000Z');

    const [a, b] = await Promise.all(
      [90_100, 90_200].map((durationMs, i) =>
        runs.save(
          runs.create({
            vehicleId: `tenths-${i}`,
            stageId: 'SS2',
            attempt: 1,
            startTime: start,
            finishTime: new Date(start.getTime() + durationMs),
            durationMs,
          }),
        ),
      ),
    );

    const reloaded = await runs.findBy({ stageId: 'SS2' });
    const durations = reloaded
      .map((r) => (r.finishTime as Date).getTime() - r.startTime.getTime())
      .sort((x, y) => x - y);

    expect(durations).toEqual([90_100, 90_200]);
    expect(a.id).not.toBe(b.id);
  });

  it('preserves milliseconds on a split and on a detection record', async () => {
    // The same `type: Date` mapping, so they stand or fall together — but
    // splits feed live split classification and detections are the raw
    // evidence, so neither should be assumed.
    const at = new Date('2026-08-23T12:34:56.789Z');

    const split = await dataSource.getRepository(StageSplit).save({
      stageRunId: 'r1',
      gateId: 'SPLIT1',
      splitIndex: 1,
      timestamp: at,
      elapsedMs: 12_345,
    });
    const detection = await dataSource
      .getRepository(DetectionEventRecord)
      .save({
        eventId: 'e1',
        gateId: 'G1',
        transponderId: '1234567',
        timestampGate: at,
        timestampServer: at,
        clockCorrectionMs: 0,
        rawPayload: '{}',
        processed: true,
      });

    const loadedSplit = await dataSource
      .getRepository(StageSplit)
      .findOneByOrFail({ id: split.id });
    const loadedDetection = await dataSource
      .getRepository(DetectionEventRecord)
      .findOneByOrFail({ eventId: detection.eventId });

    expect(loadedSplit.timestamp.toISOString()).toBe(at.toISOString());
    expect(loadedDetection.timestampGate.toISOString()).toBe(at.toISOString());
  });
});
