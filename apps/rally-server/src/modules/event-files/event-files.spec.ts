import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { Stage } from '../stages/stage.entity';
import {
  eventFileName,
  resolveEventFile,
  writeCurrentEventFile,
} from './event-files';
import { EventFilesService } from './event-files.service';

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
