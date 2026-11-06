import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { Readable } from 'node:stream';
import { DataSource, Repository } from 'typeorm';
import { Gate } from '../gates/gate.entity';
import { Stage } from '../stages/stage.entity';
import {
  eventFileName,
  importFileName,
  resolveEventFile,
  startsInLobby,
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
  it('has nothing to open in an empty folder', () => {
    expect(resolveEventFile(dir)).toBeNull();
  });

  it('opens the pointed-at file', () => {
    touch('a.rallygate', 10);
    touch('b.rallygate', 20);
    writeCurrentEventFile(dir, 'b.rallygate');
    expect(resolveEventFile(dir)).toBe('b.rallygate');
  });

  it('falls back to the most recent file when the pointer is stale', () => {
    touch('old.rallygate', 100);
    touch('new.rallygate', 10);
    writeCurrentEventFile(dir, 'deleted.rallygate');
    expect(resolveEventFile(dir)).toBe('new.rallygate');
  });

  it('never follows a pointer out of the folder', () => {
    touch('a.rallygate', 10);
    writeCurrentEventFile(dir, '../elsewhere.rallygate');
    expect(resolveEventFile(dir)).toBe('a.rallygate');
  });
});

describe('startsInLobby', () => {
  it('when the launcher asks for it, though there is an event to open', () => {
    touch('a.rallygate', 10);
    expect(startsInLobby()).toBe(false);
    process.env.LOBBY = '1';
    expect(startsInLobby()).toBe(true);
  });

  it('when the folder is empty', () => {
    expect(startsInLobby()).toBe(true);
  });

  it('never with the event fixed by config', () => {
    process.env.LOBBY = '1';
    process.env.DB_PATH = join(dir, 'fixed.rallygate');
    expect(startsInLobby()).toBe(false);
    delete process.env.DB_PATH;
    process.env.DB_TYPE = 'postgres';
    expect(startsInLobby()).toBe(false);
  });
});

describe('eventFileName', () => {
  it('strips what a file system rejects', () => {
    expect(eventFileName('2026-10-12', ' Rallye: Eifel/Nord. ')).toBe(
      '2026-10-12 Rallye EifelNord.rallygate',
    );
  });

  it('refuses a name with nothing usable left', () => {
    expect(eventFileName('2026-10-12', '?*')).toBeNull();
  });
});

describe('importFileName', () => {
  it('keeps only the cleaned last segment, with our extension', () => {
    expect(importFileName('C:\\fakepath\\2026 Eifel.rallygate')).toBe(
      '2026 Eifel.rallygate',
    );
    expect(importFileName('../../etc/Eifel: Nord.RALLYGATE')).toBe(
      'Eifel Nord.rallygate',
    );
    expect(importFileName('Eifel.sqlite')).toBe('Eifel.sqlite.rallygate');
    expect(importFileName('../..')).toBeNull();
  });
});

/** A file as Rally Gate writes it, as far as an import checks. */
function eventDb(path: string, name = 'Eifel'): void {
  const db = new Database(path);
  db.exec('CREATE TABLE rally_info (id TEXT PRIMARY KEY, name TEXT)');
  db.prepare('INSERT INTO rally_info VALUES (?, ?)').run('rally', name);
  db.close();
}

function upload(path: string): Readable {
  return Readable.from([readFileSync(path)]);
}

const rallyName = (path: string) => {
  const db = new Database(path, { readonly: true });
  const row = db.prepare('SELECT name FROM rally_info').get() as {
    name: string;
  };
  db.close();
  return row.name;
};

describe('EventFilesService', () => {
  function makeService(activeStages = 0) {
    const emitter = { emit: jest.fn() };
    const service = new EventFilesService(
      emitter as unknown as EventEmitter2,
      {
        countBy: jest.fn().mockResolvedValue(activeStages),
      } as unknown as Repository<Stage>,
      {
        options: { database: join(dir, 'current.rallygate') },
      } as unknown as DataSource,
    );
    return { service, emitter };
  }

  it('switches to a listed file by restarting', async () => {
    touch('current.rallygate', 10);
    touch('other.rallygate', 20);
    const { service, emitter } = makeService();
    await service.open('other.rallygate');
    expect(resolveEventFile(dir)).toBe('other.rallygate');
    expect(emitter.emit).toHaveBeenCalledWith('app.restart');
  });

  it('refuses while a stage is active', async () => {
    touch('other.rallygate', 20);
    const { service, emitter } = makeService(1);
    await expect(service.open('other.rallygate')).rejects.toThrow(
      ConflictException,
    );
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('refuses when the event is fixed by DB_PATH', async () => {
    process.env.DB_PATH = join(dir, 'fixed.rallygate');
    const { service } = makeService();
    expect(service.info().switchable).toBe(false);
    await expect(service.open('other.rallygate')).rejects.toThrow(
      ConflictException,
    );
  });

  it('only opens files from the folder', async () => {
    const { service } = makeService();
    await expect(service.open('../../etc/passwd')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('deletes an event file with its side files, never the open one', () => {
    touch('current.rallygate', 10);
    touch('other.rallygate', 20);
    touch('other.rallygate-wal', 20);
    touch('other.rallygate-journal', 20);
    const { service } = makeService();
    expect(() => service.delete('current.rallygate')).toThrow(
      ConflictException,
    );
    service.delete('other.rallygate');
    expect(readdirSync(dir).sort()).toEqual(['current.rallygate']);
  });

  it('deletes only files listed in the folder', () => {
    const outside = join(dir, '..', `${basename(dir)}-outside.rallygate`);
    writeFileSync(outside, '');
    try {
      const { service } = makeService();
      expect(() => service.delete(`../${basename(outside)}`)).toThrow(
        NotFoundException,
      );
      expect(() => service.delete('current.rallygate-wal')).toThrow(
        NotFoundException,
      );
      expect(existsSync(outside)).toBe(true);
    } finally {
      rmSync(outside);
    }
  });

  describe('import', () => {
    let source: string;
    beforeEach(() => {
      source = join(tmpdir(), `rally-import-${basename(dir)}.rallygate`);
      eventDb(source, 'Imported');
    });
    afterEach(() => rmSync(source, { force: true }));

    it('places a checked event file in the folder, not opened', async () => {
      const { service, emitter } = makeService();
      await expect(
        service.importEvent(upload(source), 'Eifel.rallygate', false),
      ).resolves.toEqual({ file: 'Eifel.rallygate' });
      expect(rallyName(join(dir, 'Eifel.rallygate'))).toBe('Imported');
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('refuses anything but a Rally Gate event', async () => {
      const { service } = makeService();
      const plain = join(tmpdir(), `rally-plain-${basename(dir)}`);
      writeFileSync(plain, 'not a database');
      const other = join(tmpdir(), `rally-other-${basename(dir)}`);
      new Database(other).exec('CREATE TABLE x (a)').close();
      try {
        for (const path of [plain, other]) {
          await expect(
            service.importEvent(upload(path), 'Eifel.rallygate', false),
          ).rejects.toMatchObject({
            response: { code: 'importNotAnEvent' },
          });
        }
      } finally {
        rmSync(plain);
        rmSync(other);
      }
      expect(readdirSync(dir)).toEqual([]);
    });

    it('refuses a file over the limit', async () => {
      const { service } = makeService();
      await expect(
        service.importEvent(upload(source), 'Eifel.rallygate', false, 100),
      ).rejects.toMatchObject({ response: { code: 'importTooLarge' } });
      expect(readdirSync(dir)).toEqual([]);
    });

    it('replaces an existing event only when asked, never the open one', async () => {
      eventDb(join(dir, 'Eifel.rallygate'), 'Old');
      touch('Eifel.rallygate-journal', 10);
      touch('current.rallygate', 10);
      const { service } = makeService();
      await expect(
        service.importEvent(upload(source), 'Eifel.rallygate', false),
      ).rejects.toMatchObject({ response: { code: 'eventFileExists' } });
      await expect(
        service.importEvent(upload(source), 'current.rallygate', true),
      ).rejects.toMatchObject({ response: { code: 'eventIsOpen' } });
      await service.importEvent(upload(source), 'Eifel.rallygate', true);
      expect(rallyName(join(dir, 'Eifel.rallygate'))).toBe('Imported');
      expect(readdirSync(dir).sort()).toEqual([
        'Eifel.rallygate',
        'current.rallygate',
      ]);
    });
  });

  it('downloads the open event through SQLite backup', async () => {
    const path = join(dir, 'current.rallygate');
    eventDb(path, 'Live');
    const db = new Database(path);
    try {
      db.prepare('UPDATE rally_info SET name = ?').run('Written');
      const service = new EventFilesService(
        { emit: jest.fn() } as unknown as EventEmitter2,
        { countBy: jest.fn() } as unknown as Repository<Stage>,
        {
          options: { database: path },
          driver: { databaseConnection: db },
        } as unknown as DataSource,
      );
      const snapshot = await service.snapshot('current.rallygate');
      try {
        expect(rallyName(snapshot)).toBe('Written');
      } finally {
        rmSync(snapshot);
      }
      await expect(service.snapshot('../current.rallygate')).rejects.toThrow(
        NotFoundException,
      );
    } finally {
      db.close();
    }
  });

  it('in the lobby, opens the last event and creates one from nothing', async () => {
    touch('last.rallygate', 10);
    const emitter = { emit: jest.fn() };
    const lobby = new EventFilesService(emitter as unknown as EventEmitter2);
    expect(lobby.info()).toMatchObject({ file: null, last: 'last.rallygate' });
    await lobby.open('last.rallygate');
    await lobby.create({ name: 'Eifel', date: '2026-10-12' });
    expect(resolveEventFile(dir)).toBe('2026-10-12 Eifel.rallygate');
    expect(emitter.emit).toHaveBeenCalledTimes(2);
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
    process.env.DB_PATH = join(dir, 'fixed.rallygate');
    const service = await makeService([{ id: 'G1', name: 'G1' }]);
    service.remember({ id: 'G2', name: 'G2' });
    expect(existsSync(hardwareFile())).toBe(false);
  });
});
