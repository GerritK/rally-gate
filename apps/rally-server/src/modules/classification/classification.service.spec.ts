import { StageStatus, EntryStatus } from '@rally-gate/shared';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { GatesService } from '../gates/gates.service';
import { SettingsService } from '../settings/settings.service';
import { StageRunsService } from '../stage-runs/stage-runs.service';
import { StagesService } from '../stages/stages.service';
import { EntriesService } from '../entries/entries.service';
import { ClassificationService } from './classification.service';

/**
 * Deliberately not `DEFAULT_NOTIONAL_PENALTY_MS`. These cases demonstrate how
 * the penalty behaves, so they pin their own value — otherwise retuning the
 * product default would silently change what they claim to prove.
 *
 * 30s against ~100s stages is a *small* penalty, which is the point: it keeps
 * the "quick crew can still lead on fewer stages" case under test.
 */
const SMALL_PENALTY_MS = 30_000;

function makeService(
  stage: { status: StageStatus },
  runs: unknown[],
  entries: unknown[],
) {
  const stagesService = {
    findOne: jest.fn().mockResolvedValue(stage),
  } as unknown as StagesService;
  const stageRunsService = {
    findByStage: jest.fn().mockResolvedValue(runs),
  } as unknown as StageRunsService;
  const entriesService = {
    findAll: jest.fn().mockResolvedValue(entries),
  } as unknown as EntriesService;
  const gatesService = {} as unknown as GatesService;
  const gateAssignmentsService = {} as unknown as GateAssignmentsService;
  return new ClassificationService(
    stageRunsService,
    stagesService,
    entriesService,
    gatesService,
    gateAssignmentsService,
    {} as unknown as SettingsService,
  );
}

function makeOverallService(
  stages: { id: string; status: StageStatus }[],
  finishedRuns: unknown[],
  entries: unknown[],
  notionalPenaltyMs = SMALL_PENALTY_MS,
) {
  const stageRunsService = {
    findAllFinished: jest.fn().mockResolvedValue(finishedRuns),
  } as unknown as StageRunsService;
  const stagesService = {
    findAll: jest.fn().mockResolvedValue(stages),
  } as unknown as StagesService;
  const entriesService = {
    findAll: jest.fn().mockResolvedValue(entries),
    findClass: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(id === 'unknown' ? null : { id }),
      ),
  } as unknown as EntriesService;
  const settingsService = {
    getNumber: jest.fn().mockResolvedValue(notionalPenaltyMs),
  } as unknown as SettingsService;
  return new ClassificationService(
    stageRunsService,
    stagesService,
    entriesService,
    {} as unknown as GatesService,
    {} as unknown as GateAssignmentsService,
    settingsService,
  );
}

describe('ClassificationService.getOverallClassification', () => {
  const entries = [
    { id: 'v1', startNumber: 1, driverFirstName: 'Went the distance' },
    { id: 'v2', startNumber: 2, driverFirstName: 'Quick but retired' },
  ];
  const twoClosed = [
    { id: 'SS1', status: StageStatus.CLOSED },
    { id: 'SS2', status: StageStatus.CLOSED },
  ];

  // v2 is quicker on SS1 (60s vs 100s) but never completes SS2. Without a
  // notional its total is 60s against v1's 200s and it "wins" the rally.
  const runs = [
    { entryId: 'v1', stageId: 'SS1', durationMs: 100_000 },
    { entryId: 'v1', stageId: 'SS2', durationMs: 100_000 },
    { entryId: 'v2', stageId: 'SS1', durationMs: 60_000 },
  ];

  it('substitutes a notional time for a stage the crew did not complete', async () => {
    const service = makeOverallService(twoClosed, runs, entries);

    const result = await service.getOverallClassification();

    // v2: real 60s on SS1, plus notional on SS2 = slowest there (100s, v1's
    // only time) + 30s penalty = 130s. Total 190s.
    expect(result.map((e) => [e.entryId, e.durationMs])).toEqual([
      ['v2', 190_000],
      ['v1', 200_000],
    ]);
  });

  it('keeps a notional worse than the real time it replaces', async () => {
    // The property everything else rests on: v2 is charged 130s for SS2,
    // strictly more than the 100s it would have taken to actually drive it,
    // so skipping a stage never pays off *on that stage*.
    const service = makeOverallService(twoClosed, runs, entries);

    const result = await service.getOverallClassification();
    const retired = result.find((e) => e.entryId === 'v2')!;

    expect(retired.durationMs - 60_000).toBeGreaterThan(100_000);
  });

  it('ranks on total time alone once notionals make totals comparable', async () => {
    // v2 leads on 190s despite completing only one stage, because it was 40s
    // quicker on SS1 and the penalty only costs it 30s. That is the correct
    // rally answer — lowest total wins — and it is the reason a
    // stages-completed sort must NOT override total time.
    //
    // It also shows the penalty is the knob that decides how punishing a
    // retirement is: see the larger-penalty case below.
    const service = makeOverallService(twoClosed, runs, entries);

    const result = await service.getOverallClassification();

    expect(result.map((e) => [e.entryId, e.position, e.gapMs])).toEqual([
      ['v2', 1, 0],
      ['v1', 2, 10_000],
    ]);
  });

  it('reports stages actually driven, not stages counted', async () => {
    const service = makeOverallService(twoClosed, runs, entries);

    const result = await service.getOverallClassification();

    expect(result.map((e) => [e.entryId, e.stagesCompleted])).toEqual([
      ['v2', 1],
      ['v1', 2],
    ]);
  });

  it('lists each counted stage in order, marking notionals', async () => {
    const service = makeOverallService(twoClosed, runs, entries);

    const result = await service.getOverallClassification();
    const retired = result.find((e) => e.entryId === 'v2')!;

    expect(retired.stageTimes).toEqual([
      { stageId: 'SS1', durationMs: 60_000, notional: false },
      { stageId: 'SS2', durationMs: 130_000, notional: true },
    ]);
  });

  it('sinks a crew below a finisher once the penalty outweighs its pace', async () => {
    const service = makeOverallService(twoClosed, runs, entries, 60_000);

    const result = await service.getOverallClassification();

    // Same runs, bigger penalty: v2's SS2 notional becomes 160s, total 220s.
    expect(result.map((e) => [e.entryId, e.position])).toEqual([
      ['v1', 1],
      ['v2', 2],
    ]);
  });

  it('ignores stages that are not closed yet', async () => {
    // SS2 is still running, so v1 finishing it must not count and v2 must
    // not be penalised for a stage nobody has completed.
    const service = makeOverallService(
      [
        { id: 'SS1', status: StageStatus.CLOSED },
        { id: 'SS2', status: StageStatus.ACTIVE },
      ],
      runs,
      entries,
    );

    const result = await service.getOverallClassification();

    expect(result.map((e) => [e.entryId, e.durationMs])).toEqual([
      ['v2', 60_000],
      ['v1', 100_000],
    ]);
  });

  it('excludes a registered car that never completed a stage', async () => {
    // Otherwise a no-show collects notionals for the whole rally and lands
    // in the results on an entirely invented total.
    const service = makeOverallService(twoClosed, runs, [
      ...entries,
      { id: 'v3', startNumber: 3, driverFirstName: 'Never turned up' },
    ]);

    const result = await service.getOverallClassification();

    expect(result.map((e) => e.entryId)).toEqual(['v2', 'v1']);
  });

  it('drops a closed stage nobody finished instead of inventing a basis', async () => {
    const service = makeOverallService(
      [...twoClosed, { id: 'SS3', status: StageStatus.CLOSED }],
      runs,
      entries,
    );

    const result = await service.getOverallClassification();

    // SS3 contributes nothing: with no real time to anchor a notional, every
    // crew would receive the same invented figure and no position would move.
    expect(result.map((e) => e.durationMs)).toEqual([190_000, 200_000]);
  });

  it('leaves a disqualified car out, its times and the notionals they set', async () => {
    // v3 is the slowest on SS2; still ranked, its time would set the notional
    // charged to v2 there.
    const service = makeOverallService(
      twoClosed,
      [
        ...runs,
        { entryId: 'v3', stageId: 'SS1', durationMs: 50_000 },
        { entryId: 'v3', stageId: 'SS2', durationMs: 400_000 },
      ],
      [
        ...entries,
        {
          id: 'v3',
          startNumber: 3,
          driverFirstName: 'Disqualified',
          status: EntryStatus.DISQUALIFIED,
        },
      ],
    );

    const result = await service.getOverallClassification();

    // As if v3 had never run: v2's notional on SS2 is 100s + 30s again.
    expect(result.map((e) => [e.entryId, e.durationMs])).toEqual([
      ['v2', 190_000],
      ['v1', 200_000],
    ]);
  });

  it('leaves a withdrawn car out, its times still setting the notionals', async () => {
    // v3 retires after SS2, where it was the slowest: its 400s still sets
    // the notional v2 is charged there, as before it withdrew.
    const service = makeOverallService(
      twoClosed,
      [
        ...runs,
        { entryId: 'v3', stageId: 'SS1', durationMs: 50_000 },
        { entryId: 'v3', stageId: 'SS2', durationMs: 400_000 },
      ],
      [
        ...entries,
        {
          id: 'v3',
          startNumber: 3,
          driverFirstName: 'Withdrawn',
          status: EntryStatus.WITHDRAWN,
        },
      ],
    );

    const result = await service.getOverallClassification();

    expect(result.map((e) => [e.entryId, e.durationMs])).toEqual([
      ['v1', 200_000],
      ['v2', 490_000],
    ]);
  });

  it('returns nothing before any stage has closed', async () => {
    const service = makeOverallService(
      [{ id: 'SS1', status: StageStatus.ACTIVE }],
      runs,
      entries,
    );

    await expect(service.getOverallClassification()).resolves.toEqual([]);
  });
});

describe('ClassificationService.getOverallClassification by class', () => {
  const twoClosed = [
    { id: 'SS1', status: StageStatus.CLOSED },
    { id: 'SS2', status: StageStatus.CLOSED },
  ];
  const entries = [
    {
      id: 'v1',
      startNumber: 1,
      driverFirstName: 'A',
      classes: [{ id: '2WD' }],
    },
    {
      id: 'v2',
      startNumber: 2,
      driverFirstName: 'B',
      classes: [{ id: '2WD' }],
    },
    {
      id: 'v3',
      startNumber: 3,
      driverFirstName: 'C',
      classes: [{ id: '4WD' }],
    },
  ];
  // v3 is far slower on SS2; overall, that drags v2's SS2 notional up to it.
  const runs = [
    { entryId: 'v1', stageId: 'SS1', durationMs: 100_000 },
    { entryId: 'v1', stageId: 'SS2', durationMs: 100_000 },
    { entryId: 'v2', stageId: 'SS1', durationMs: 60_000 },
    { entryId: 'v3', stageId: 'SS1', durationMs: 200_000 },
    { entryId: 'v3', stageId: 'SS2', durationMs: 300_000 },
  ];

  it('anchors notionals on the slowest time within the class, not overall', async () => {
    const service = makeOverallService(twoClosed, runs, entries);

    const overall = await service.getOverallClassification();
    const inClass = await service.getOverallClassification(['2WD']);

    // Overall v2's SS2 notional is 300s + 30s; within 2WD it is 100s + 30s.
    expect(overall.find((e) => e.entryId === 'v2')!.durationMs).toBe(390_000);
    expect(inClass.map((e) => [e.entryId, e.position, e.durationMs])).toEqual([
      ['v2', 1, 190_000],
      ['v1', 2, 200_000],
    ]);
  });

  it('puts an entry in every class it belongs to', async () => {
    const service = makeOverallService(twoClosed, runs, [
      ...entries.slice(0, 2),
      { ...entries[2], classes: [{ id: '4WD' }, { id: '2WD' }] },
    ]);

    const inClass = await service.getOverallClassification(['2WD']);

    expect(inClass.map((e) => e.entryId)).toEqual(['v1', 'v2', 'v3']);
  });

  it('combines classes as an intersection', async () => {
    const service = makeOverallService(twoClosed, runs, [
      { ...entries[0], classes: [{ id: '2WD' }, { id: 'Rookie' }] },
      entries[1],
      { ...entries[2], classes: [{ id: '4WD' }, { id: 'Rookie' }] },
    ]);

    const rookies2wd = await service.getOverallClassification([
      '2WD',
      'Rookie',
    ]);

    expect(rookies2wd.map((e) => e.entryId)).toEqual(['v1']);
  });

  it('404s an unknown class instead of returning an empty table', async () => {
    const service = makeOverallService(twoClosed, runs, entries);

    await expect(
      service.getOverallClassification(['2WD', 'unknown']),
    ).rejects.toThrow('Class unknown not found');
  });
});

describe('ClassificationService.getStageClassification', () => {
  it('still ranks a single stage on time alone, with real gaps', async () => {
    // The overall fix must not leak into per-stage ranking, where every
    // entry is one run and totals are directly comparable.
    const entries = [
      { id: 'v1', startNumber: 1, driverFirstName: 'A' },
      { id: 'v2', startNumber: 2, driverFirstName: 'B' },
    ];
    const stagesService = {
      findOne: jest.fn().mockResolvedValue({ status: StageStatus.CLOSED }),
    } as unknown as StagesService;
    const stageRunsService = {
      findFinishedByStage: jest.fn().mockResolvedValue([
        { entryId: 'v2', durationMs: 130_000 },
        { entryId: 'v1', durationMs: 100_000 },
      ]),
    } as unknown as StageRunsService;
    const service = new ClassificationService(
      stageRunsService,
      stagesService,
      {
        findAll: jest.fn().mockResolvedValue(entries),
      } as unknown as EntriesService,
      {} as unknown as GatesService,
      {} as unknown as GateAssignmentsService,
      {} as unknown as SettingsService,
    );

    const result = await service.getStageClassification('SS1');

    expect(result.map((e) => [e.entryId, e.position, e.gapMs])).toEqual([
      ['v1', 1, 0],
      ['v2', 2, 30_000],
    ]);
  });

  it('leaves a disqualified car out, the cars behind moving up', async () => {
    const entries = [
      { id: 'v1', startNumber: 1, driverFirstName: 'A' },
      {
        id: 'v2',
        startNumber: 2,
        driverFirstName: 'B',
        status: EntryStatus.DISQUALIFIED,
      },
      { id: 'v3', startNumber: 3, driverFirstName: 'C' },
    ];
    const service = new ClassificationService(
      {
        findFinishedByStage: jest.fn().mockResolvedValue([
          { entryId: 'v2', durationMs: 90_000 },
          { entryId: 'v1', durationMs: 100_000 },
          { entryId: 'v3', durationMs: 110_000 },
        ]),
      } as unknown as StageRunsService,
      {
        findOne: jest.fn().mockResolvedValue({ status: StageStatus.CLOSED }),
      } as unknown as StagesService,
      {
        findAll: jest.fn().mockResolvedValue(entries),
      } as unknown as EntriesService,
      {} as unknown as GatesService,
      {} as unknown as GateAssignmentsService,
      {} as unknown as SettingsService,
    );

    const result = await service.getStageClassification('SS1');

    expect(result.map((e) => [e.entryId, e.position, e.gapMs])).toEqual([
      ['v1', 1, 0],
      ['v3', 2, 10_000],
    ]);
  });
});

describe('ClassificationService.getNonFinishers', () => {
  const entries = [
    { id: 'v1', startNumber: 1, driverFirstName: 'Started, no finish' },
    { id: 'v2', startNumber: 2, driverFirstName: 'Never started' },
    { id: 'v3', startNumber: 3, driverFirstName: 'Finished' },
  ];

  it('reports no one while the stage is still open, even with no runs yet', async () => {
    const service = makeService(
      { status: StageStatus.NOT_STARTED },
      [],
      entries,
    );
    expect(await service.getNonFinishers('WP1')).toEqual([]);
  });

  it('reports no one before the stage closes, even with an unfinished run — it is still running, not DNF', async () => {
    const runs = [{ entryId: 'v1', finishTime: undefined }];
    const service = makeService(
      { status: StageStatus.NOT_STARTED },
      runs,
      entries,
    );
    expect(await service.getNonFinishers('WP1')).toEqual([]);
  });

  it('reports DNF (unfinished run) and DNS (no run at all) once the stage is closed', async () => {
    const runs = [
      { entryId: 'v1', finishTime: undefined },
      { entryId: 'v3', finishTime: new Date() },
    ];
    const service = makeService({ status: StageStatus.CLOSED }, runs, entries);
    const result = await service.getNonFinishers('WP1');
    expect(result).toEqual([
      expect.objectContaining({ entryId: 'v1', outcome: 'DNF' }),
      expect.objectContaining({ entryId: 'v2', outcome: 'DNS' }),
    ]);
  });

  it('lists a disqualified car that drove the stage as DSQ, even before it closes', async () => {
    const withDsq = [
      ...entries,
      {
        id: 'v4',
        startNumber: 4,
        driverFirstName: 'Disqualified',
        status: EntryStatus.DISQUALIFIED,
      },
    ];
    const runs = [{ entryId: 'v4', finishTime: undefined }];
    const open = makeService({ status: StageStatus.ACTIVE }, runs, withDsq);
    expect(await open.getNonFinishers('WP1')).toEqual([
      expect.objectContaining({ entryId: 'v4', outcome: 'DSQ' }),
    ]);

    // Closed, its unfinished run is DSQ, not DNF; and a disqualified car
    // that never ran isn't a DNS.
    const closed = makeService(
      { status: StageStatus.CLOSED },
      [...runs, { entryId: 'v3', finishTime: new Date() }],
      withDsq,
    );
    const outcomes = (await closed.getNonFinishers('WP1')).map((e) => [
      e.entryId,
      e.outcome,
    ]);
    expect(outcomes).toEqual([
      ['v1', 'DNS'],
      ['v2', 'DNS'],
      ['v4', 'DSQ'],
    ]);
  });
});
