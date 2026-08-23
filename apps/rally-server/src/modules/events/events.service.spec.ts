import { GateRole, StageStatus } from '@rally-gate/shared';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { GatesService } from '../gates/gates.service';
import { StageRunsService } from '../stage-runs/stage-runs.service';
import { StagesService } from '../stages/stages.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { DetectionEventRecord } from './detection-event.entity';
import { EventsService } from './events.service';

const GATE = { id: 'G1', name: 'G1', clockOffsetMs: null };
const VEHICLE = { id: 'v1', transponderId: '1234567' };

function makeService(opts: {
  gate?: unknown;
  vehicle?: unknown;
  pending?: unknown[];
  startRun?: jest.Mock;
  stageStatus?: StageStatus;
}) {
  const saved: DetectionEventRecord[] = [];
  const events = {
    create: jest
      .fn()
      .mockImplementation((r: DetectionEventRecord) => ({ ...r })),
    save: jest.fn().mockImplementation((r: DetectionEventRecord) => {
      saved.push({ ...r });
      return Promise.resolve(r);
    }),
    find: jest.fn().mockResolvedValue(opts.pending ?? []),
  };
  const gatesService = {
    findOne: jest.fn().mockResolvedValue('gate' in opts ? opts.gate : GATE),
    clockCorrectionMsFor: jest.fn().mockResolvedValue(0),
  } as unknown as GatesService;
  const vehiclesService = {
    findByTransponder: jest
      .fn()
      .mockResolvedValue('vehicle' in opts ? opts.vehicle : VEHICLE),
  } as unknown as VehiclesService;
  const gateAssignmentsService = {
    findActiveForGate: jest
      .fn()
      .mockResolvedValue({ stageId: 'SS1', role: GateRole.STAGE_START }),
  } as unknown as GateAssignmentsService;
  const startRun = opts.startRun ?? jest.fn().mockResolvedValue({ id: 'r1' });
  const stageRunsService = { startRun } as unknown as StageRunsService;
  const stagesService = {
    findOne: jest.fn().mockResolvedValue({
      id: 'SS1',
      status: opts.stageStatus ?? StageStatus.ACTIVE,
    }),
  } as unknown as StagesService;
  const emitter = { emit: jest.fn() };

  const service = new EventsService(
    events as never,
    gatesService,
    gateAssignmentsService,
    vehiclesService,
    stageRunsService,
    stagesService,
    emitter as never,
  );
  return { service, events, saved, startRun, emitter };
}

function detection(overrides: Record<string, unknown> = {}) {
  return {
    topic: 'rally/gates/G1/detections',
    payload: Buffer.from(
      JSON.stringify({
        eventId: 'e1',
        gateId: 'G1',
        transponderId: '1234567',
        timestampGate: '2026-01-01T12:00:00.000Z',
        source: 'test',
        ...overrides,
      }),
    ),
  };
}

describe('EventsService detection failures', () => {
  it('keeps the raw detection when rule application fails', async () => {
    // The passing itself must survive even when the timing logic blows up —
    // it is the only evidence the car came past at all.
    const { service, saved } = makeService({
      startRun: jest.fn().mockRejectedValue(new Error('SQLITE_BUSY')),
    });

    await service.handleMqttMessage(detection());

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ eventId: 'e1', processed: false });
  });

  it('leaves a failed detection pending instead of throwing it away', async () => {
    // @nestjs/event-emitter defaults to suppressErrors, so a thrown error
    // here would be logged and dropped with nothing tracking it. Staying
    // unprocessed is what makes it countable and retryable.
    const { service, saved } = makeService({
      startRun: jest.fn().mockRejectedValue(new Error('SQLITE_BUSY')),
    });

    await expect(service.handleMqttMessage(detection())).resolves.not.toThrow();

    expect(saved.some((r) => r.processed)).toBe(false);
  });

  it('publishes the backlog on failure instead of only logging it', async () => {
    // The failure has to reach the live feed under the name LiveController
    // subscribes to. An emit nothing listens for is indistinguishable from
    // no emit at all, which is how this was missed the first time.
    const { service, emitter } = makeService({
      startRun: jest.fn().mockRejectedValue(new Error('SQLITE_BUSY')),
    });

    await service.handleMqttMessage(detection());

    // Empty because the repository is mocked; what matters is that the event
    // fires under the name LiveController subscribes to, carrying the list.
    expect(emitter.emit).toHaveBeenCalledWith('detection.pending-changed', {
      pending: [],
    });
  });

  it.each([StageStatus.NOT_STARTED, StageStatus.CLOSED])(
    'stores without timing when the assigned stage is %s',
    async (stageStatus) => {
      // GateAssignment.active and Stage.status are two records kept in step
      // by StagesService, and activate updates them in separate steps — so a
      // gate can be live on a stage that isn't. The detection is still kept;
      // it just must not attach a run to a stage nobody is running.
      const { service, saved, startRun } = makeService({ stageStatus });

      await service.handleMqttMessage(detection());

      expect(startRun).not.toHaveBeenCalled();
      expect(saved.at(-1)).toMatchObject({ eventId: 'e1', processed: true });
    },
  );

  it('marks a detection processed once its rules apply', async () => {
    const { service, saved } = makeService({});

    await service.handleMqttMessage(detection());

    expect(saved.at(-1)).toMatchObject({ processed: true });
  });

  const nothingToApply: [string, { gate?: null; vehicle?: null }][] = [
    ['an unknown gate', { gate: null }],
    ['an unregistered transponder', { vehicle: null }],
  ];

  it.each(nothingToApply)(
    'marks %s processed rather than leaving it pending',
    async (_l, opts) => {
      // Nothing to apply and retrying would never change that, so these must
      // not accumulate in the pending list — it is meant to hold real
      // failures, not stray passings from a car that isn't in this event.
      const { service, saved } = makeService(opts);

      await service.handleMqttMessage(detection());

      expect(saved.at(-1)).toMatchObject({ processed: true });
    },
  );
});

describe('EventsService.reprocessPending', () => {
  const pendingRecord = {
    eventId: 'e1',
    gateId: 'G1',
    vehicleId: 'v1',
    transponderId: '1234567',
    timestampGate: new Date('2026-01-01T12:00:00.000Z'),
    clockCorrectionMs: 0,
    processed: false,
  };

  it('retries a pending detection and marks it processed', async () => {
    const { service, saved, startRun } = makeService({
      pending: [{ ...pendingRecord }],
    });

    await expect(service.reprocessPending()).resolves.toBe(1);

    expect(startRun).toHaveBeenCalled();
    expect(saved.at(-1)).toMatchObject({ eventId: 'e1', processed: true });
  });

  it('reports nothing recovered when the retry fails again', async () => {
    const { service } = makeService({
      pending: [{ ...pendingRecord }],
      startRun: jest.fn().mockRejectedValue(new Error('still broken')),
    });

    await expect(service.reprocessPending()).resolves.toBe(0);
  });

  it('replays with the correction stored at ingest, not a fresh one', async () => {
    // The gate's offset may have moved since. Re-measuring would time the
    // run against a clock the detection was never read on — the reason the
    // applied correction is stored per detection in the first place.
    const { service, startRun } = makeService({
      pending: [{ ...pendingRecord, clockCorrectionMs: 5_000 }],
    });

    await service.reprocessPending();

    expect(startRun).toHaveBeenCalledWith(
      'v1',
      'SS1',
      new Date('2026-01-01T12:00:05.000Z'),
    );
  });

  it('does nothing when there is nothing pending', async () => {
    const { service, startRun } = makeService({ pending: [] });

    await expect(service.reprocessPending()).resolves.toBe(0);
    expect(startRun).not.toHaveBeenCalled();
  });
});
