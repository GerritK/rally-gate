import { ConflictException } from '@nestjs/common';
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
  assignment?: unknown;
  stored?: unknown;
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
    findOneBy: jest.fn().mockResolvedValue(opts.stored ?? null),
  };
  const gatesService = {
    findOne: jest.fn().mockResolvedValue('gate' in opts ? opts.gate : GATE),
    clockCorrectionMsFor: jest.fn().mockResolvedValue(0),
  } as unknown as GatesService;
  const vehiclesService = {
    findByTransponder: jest
      .fn()
      .mockResolvedValue('vehicle' in opts ? opts.vehicle : VEHICLE),
    findOne: jest.fn().mockResolvedValue(VEHICLE),
  } as unknown as VehiclesService;
  const gateAssignmentsService = {
    findActiveForGate: jest
      .fn()
      .mockResolvedValue(
        'assignment' in opts
          ? opts.assignment
          : { stageId: 'SS1', role: GateRole.STAGE_START },
      ),
  } as unknown as GateAssignmentsService;
  const startRun =
    opts.startRun ??
    jest
      .fn()
      .mockImplementation((_v: string, _s: string, at: Date) =>
        Promise.resolve({ id: 'r1', startTime: at }),
      );
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
    // The detection is the only evidence the car came past at all.
    const { service, saved } = makeService({
      startRun: jest.fn().mockRejectedValue(new Error('SQLITE_BUSY')),
    });

    await service.handleMqttMessage(detection());

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ eventId: 'e1', processed: false });
  });

  it('leaves a failed detection pending instead of throwing it away', async () => {
    // @nestjs/event-emitter defaults to suppressErrors, so a throw here would
    // be dropped; staying unprocessed is what makes it retryable.
    const { service, saved } = makeService({
      startRun: jest.fn().mockRejectedValue(new Error('SQLITE_BUSY')),
    });

    await expect(service.handleMqttMessage(detection())).resolves.not.toThrow();

    expect(saved.some((r) => r.processed)).toBe(false);
  });

  it('publishes the backlog on failure instead of only logging it', async () => {
    // An emit nothing listens for is indistinguishable from no emit at all,
    // which is how this was missed the first time.
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
      // A gate can be live on a stage that isn't — see applyRules. The
      // detection is kept, it just must not attach a run to that stage.
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
      // Retrying would never change these, so they must not accumulate in a
      // pending list meant to hold real failures.
      const { service, saved } = makeService(opts);

      await service.handleMqttMessage(detection());

      expect(saved.at(-1)).toMatchObject({ processed: true });
    },
  );
});

describe('EventsService detection payload validation', () => {
  // MQTT is the one ingress the global ValidationPipe doesn't cover, on an
  // unauthenticated broker.
  it.each([
    ['a missing eventId', { eventId: undefined }],
    ['an empty gateId', { gateId: '' }],
    ['a non-string transponderId', { transponderId: 1234567 }],
    ['an unparseable timestampGate', { timestampGate: 'yesterday-ish' }],
    ['an absurdly long gateId', { gateId: 'g'.repeat(500) }],
  ])('drops a detection with %s', async (_label, overrides) => {
    const { service, saved, startRun } = makeService({});

    await service.handleMqttMessage(detection(overrides));

    // Dropped outright rather than stored — see parseDetection.
    expect(saved).toHaveLength(0);
    expect(startRun).not.toHaveBeenCalled();
  });

  it('accepts a well-formed detection', async () => {
    const { service, saved } = makeService({});

    await service.handleMqttMessage(detection());

    expect(saved).not.toHaveLength(0);
  });
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

describe('EventsService unidentified passings', () => {
  const beam = { transponderId: undefined, source: 'beam' };
  const awaiting = {
    eventId: 'e1',
    gateId: 'G1',
    transponderId: null,
    vehicleId: null,
    timestampGate: new Date('2026-01-01T12:00:00.000Z'),
    clockCorrectionMs: 2_000,
    processed: true,
    awaitingVehicle: true,
  };

  it('holds a passing without a transponder for a marshal', async () => {
    const { service, saved, startRun, emitter } = makeService({});

    await service.handleMqttMessage(detection(beam));

    expect(startRun).not.toHaveBeenCalled();
    expect(saved.at(-1)).toMatchObject({
      transponderId: null,
      awaitingVehicle: true,
      processed: true,
    });
    expect(emitter.emit).toHaveBeenCalledWith(
      'detection.awaiting-changed',
      expect.anything(),
    );
  });

  it('does not ask a marshal about a passing at an idle gate', async () => {
    const { service, saved } = makeService({ assignment: null });

    await service.handleMqttMessage(detection(beam));

    expect(saved.at(-1)).toMatchObject({ awaitingVehicle: false });
  });

  it('times an assigned passing with the correction stored at ingest', async () => {
    const { service, saved, startRun } = makeService({
      stored: { ...awaiting },
    });

    await service.assignVehicle('e1', 'v1');

    expect(startRun).toHaveBeenCalledWith(
      'v1',
      'SS1',
      new Date('2026-01-01T12:00:02.000Z'),
    );
    expect(saved.at(-1)).toMatchObject({
      vehicleId: 'v1',
      awaitingVehicle: false,
    });
  });

  it('refuses an assignment the rules would silently ignore', async () => {
    // A duplicate start hands back the existing run. Consuming the passing
    // anyway would lose it from the list with nothing timed.
    const { service, saved } = makeService({
      stored: { ...awaiting },
      startRun: jest.fn().mockResolvedValue({
        id: 'r1',
        startTime: new Date('2026-01-01T11:00:00.000Z'),
      }),
    });

    await expect(service.assignVehicle('e1', 'v1')).rejects.toThrow(
      ConflictException,
    );
    expect(saved).toHaveLength(0);
  });

  it('dismisses a passing without timing it', async () => {
    const { service, saved, startRun } = makeService({
      stored: { ...awaiting },
    });

    await service.dismissAwaiting('e1');

    expect(startRun).not.toHaveBeenCalled();
    expect(saved.at(-1)).toMatchObject({
      vehicleId: null,
      awaitingVehicle: false,
    });
  });
});
