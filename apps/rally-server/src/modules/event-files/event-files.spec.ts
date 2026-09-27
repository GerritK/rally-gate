import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { Gate } from '../gates/gate.entity';
import { Stage } from '../stages/stage.entity';
import {
  eventFileName,
  resolveEventFile,
  writeCurrentEventFile,
} from './event-files';
import { EventFilesService } from './event-files.service';
import { KnownHardwareService } from './known-hardware.service';

let dir: string;
const env = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rally-events-'));
  process.env = { ...env, EVENTS_DIR: dir };
  delete process.env.DB_PATH;
  delete process.env.DB_TYPE;
});

afterEach(() => {
  process.env = env;
  rmSync(dir, { recursive: true, force: true });
});

function touch(file: string, ageSeconds: number) {
  const path = join(dir, file);
  writeFileSync(path, '');
  const time = Date.now() / 1000 - ageSeconds;
  utimesSync(path, time, time);
}

describe('resolveEventFile', () => {
  it('keeps the legacy default for an empty folder', () => {
    expect(resolveEventFile(dir)).toBe('rally-gate.sqlite');
  });

  it('opens the pointed-at file', () => {
    touch('a.sqlite', 10);
    touch('b.sqlite', 20);
    writeCurrentEventFile(dir, 'b.sqlite');
    expect(resolveEventFile(dir)).toBe('b.sqlite');
  });

  it('falls back to the most recent file when the pointer is stale', () => {
    touch('old.sqlite', 100);
    touch('new.sqlite', 10);
    writeCurrentEventFile(dir, 'deleted.sqlite');
    expect(resolveEventFile(dir)).toBe('new.sqlite');
  });

  it('never follows a pointer out of the folder', () => {
    touch('a.sqlite', 10);
    writeCurrentEventFile(dir, '../elsewhere.sqlite');
    expect(resolveEventFile(dir)).toBe('a.sqlite');
  });
});

describe('eventFileName', () => {
  it('strips what a file system rejects', () => {
    expect(eventFileName('2026-10-12', ' Rallye: Eifel/Nord. ')).toBe(
      '2026-10-12 Rallye EifelNord.sqlite',
    );
  });

  it('refuses a name with nothing usable left', () => {
    expect(eventFileName('2026-10-12', '?*')).toBeNull();
  });
});

describe('EventFilesService', () => {
  function makeService(activeStages = 0) {
    const emitter = { emit: jest.fn() };
    const service = new EventFilesService(
      {
        countBy: jest.fn().mockResolvedValue(activeStages),
      } as unknown as Repository<Stage>,
      {
        options: { database: join(dir, 'current.sqlite') },
      } as unknown as DataSource,
      emitter as unknown as EventEmitter2,
      { list: () => [] } as unknown as KnownHardwareService,
    );
    return { service, emitter };
  }

  it('switches to a listed file by restarting', async () => {
    touch('current.sqlite', 10);
    touch('other.sqlite', 20);
    const { service, emitter } = makeService();
    await service.open('other.sqlite');
    expect(resolveEventFile(dir)).toBe('other.sqlite');
    expect(emitter.emit).toHaveBeenCalledWith('app.restart');
  });

  it('refuses while a stage is active', async () => {
    touch('other.sqlite', 20);
    const { service, emitter } = makeService(1);
    await expect(service.open('other.sqlite')).rejects.toThrow(
      ConflictException,
    );
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('refuses when the event is fixed by DB_PATH', async () => {
    process.env.DB_PATH = join(dir, 'fixed.sqlite');
    const { service } = makeService();
    expect(service.info().switchable).toBe(false);
    await expect(service.open('other.sqlite')).rejects.toThrow(
      ConflictException,
    );
  });

  it('only opens files from the folder', async () => {
    const { service } = makeService();
    await expect(service.open('../../etc/passwd')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('KnownHardwareService', () => {
  const hardwareFile = () => join(dir, 'hardware.json');
  const known = () =>
    (JSON.parse(readFileSync(hardwareFile(), 'utf8')) as { gates: unknown })
      .gates;

  async function makeService(eventGates: Partial<Gate>[] = []) {
    const service = new KnownHardwareService({
      find: jest.fn().mockResolvedValue(eventGates),
    } as unknown as Repository<Gate>);
    await service.onModuleInit();
    return service;
  }

  it("starts from the open event's gates", async () => {
    await makeService([{ id: 'G1', name: 'Start', capabilities: 'beam' }]);
    expect(known()).toEqual([{ id: 'G1', name: 'Start' }]);
  });

  it('remembers new gates and renames, and forgets on request', async () => {
    const service = await makeService();
    service.remember({ id: 'G1', name: 'G1' });
    service.remember({ id: 'G2', name: 'G2' });
    service.remember({ id: 'G1', name: 'Start' });
    service.forget('G2');
    expect(known()).toEqual([{ id: 'G1', name: 'Start' }]);
    expect((await makeService()).list()).toEqual([{ id: 'G1', name: 'Start' }]);
  });

  it('keeps nothing when the event is fixed by config', async () => {
    process.env.DB_PATH = join(dir, 'fixed.sqlite');
    const service = await makeService([{ id: 'G1', name: 'G1' }]);
    service.remember({ id: 'G2', name: 'G2' });
    expect(existsSync(hardwareFile())).toBe(false);
  });
});
