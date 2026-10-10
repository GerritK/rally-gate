import {
  EntryStatus,
  RallyStatus,
  StageRunStatus,
  StageStatus,
} from '@rally-gate/shared';
import { Entry } from '../entries/entry.entity';
import { RallyInfoService } from './rally-info.service';
import { RallyStatusService } from './rally-status.service';

function makeService(
  rally: RallyStatus,
  runs: { entryId: string; stageId: string; status: StageRunStatus }[] = [],
) {
  const saved: object[] = [];
  const rallyInfo = new RallyInfoService(
    {
      findOneBy: () => Promise.resolve({ name: 'Rally', status: rally }),
      save: (row: object) => Promise.resolve(saved.push(row)),
    } as never,
    { emit: jest.fn() } as never,
  );
  const stagesService = {
    findAll: jest.fn().mockResolvedValue([
      { id: 'WP1', status: StageStatus.CLOSED },
      { id: 'WP2', status: StageStatus.ACTIVE },
    ]),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const stageRunsService = {
    findAll: jest.fn((stageId?: string) =>
      Promise.resolve(runs.filter((r) => !stageId || r.stageId === stageId)),
    ),
  };
  return {
    service: new RallyStatusService(
      rallyInfo,
      stagesService as never,
      stageRunsService as never,
    ),
    stagesService,
    saved,
  };
}

const entry = {
  id: 'e1',
  startNumber: 7,
  status: EntryStatus.SCRUTINEERED,
  classes: [{ id: 'c1' }],
} as Entry;

describe('RallyStatusService.close', () => {
  it('refuses while a car is on stage, closing nothing', async () => {
    const { service, stagesService, saved } = makeService(RallyStatus.RUNNING, [
      { entryId: 'e1', stageId: 'WP2', status: StageRunStatus.STARTED },
    ]);

    await expect(service.close()).rejects.toMatchObject({
      response: { code: 'carsOnStage', params: { count: 1 } },
    });
    expect(stagesService.close).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('closes the running stages, then the rally', async () => {
    const { service, stagesService, saved } = makeService(RallyStatus.RUNNING);

    await service.close();

    expect(stagesService.close.mock.calls).toEqual([['WP2']]);
    expect(saved).toMatchObject([{ status: RallyStatus.CLOSED }]);
  });

  it('refuses a rally still in setup', async () => {
    const { service } = makeService(RallyStatus.SETUP);

    await expect(service.close()).rejects.toMatchObject({
      response: { code: 'rallyStatusInvalid' },
    });
  });
});

describe('RallyStatusService.assertEntryChangeAllowed', () => {
  it('keeps a timed car on its start number while running', async () => {
    const { service } = makeService(RallyStatus.RUNNING, [
      { entryId: 'e1', stageId: 'WP1', status: StageRunStatus.FINISHED },
    ]);

    await expect(
      service.assertEntryChangeAllowed(entry, { startNumber: 8 }),
    ).rejects.toMatchObject({ response: { code: 'lockedWhileRunning' } });
  });

  it('renumbers a car that has not driven while running', async () => {
    const { service } = makeService(RallyStatus.RUNNING);

    await expect(
      service.assertEntryChangeAllowed(entry, { startNumber: 8 }),
    ).resolves.toBeUndefined();
  });

  it('takes the whole form back unchanged once closed, a renamed driver included', async () => {
    const { service } = makeService(RallyStatus.CLOSED);

    await expect(
      service.assertEntryChangeAllowed(entry, {
        startNumber: 7,
        status: EntryStatus.SCRUTINEERED,
        classIds: ['c1'],
        driverFirstName: 'Bea',
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['status', { status: EntryStatus.DISQUALIFIED }],
    ['classes', { classIds: ['c1', 'c2'] }],
  ])('refuses changed %s once closed', async (_label, patch) => {
    const { service } = makeService(RallyStatus.CLOSED);

    await expect(
      service.assertEntryChangeAllowed(entry, patch),
    ).rejects.toMatchObject({ response: { code: 'lockedWhileClosed' } });
  });
});
