import {
  BadRequestException,
  ConflictException,
  PayloadTooLargeException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiErrorCode, StageStatus } from '@rally-gate/shared';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DataSource, Repository } from 'typeorm';
import type { BetterSqlite3Driver } from 'typeorm/driver/better-sqlite3/BetterSqlite3Driver';
import { apiError } from '../../common/api-error';
import { RALLY_INFO_ID, RallyInfo } from '../rally-info/rally-info.entity';
import { Stage } from '../stages/stage.entity';
import { CreateEventDto } from './dto';
import {
  deleteEventFile,
  EventFile,
  eventFileName,
  eventsDir,
  IMPORT_MAX_BYTES,
  importFileName,
  isEventFile,
  listEventFiles,
  resolveEventFile,
  writeCurrentEventFile,
} from './event-files';

export interface EventInfo {
  /** The open event: a file name, or the Postgres database name. Null in
   *  the lobby. */
  file: string | null;
  /** What a restart would open: the lobby's "Continue with". */
  last: string | null;
  switchable: boolean;
  events: EventFile[];
}

/**
 * Without the repository and DataSource in the lobby (`LobbyModule`), which
 * has no event open.
 */
@Injectable()
export class EventFilesService {
  constructor(
    private readonly emitter: EventEmitter2,
    @Optional()
    @InjectRepository(Stage)
    private readonly stages?: Repository<Stage>,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  info(): EventInfo {
    const dir = eventsDir();
    return {
      file: this.currentFile(),
      last: dir && resolveEventFile(dir),
      switchable: dir !== null,
      events: dir ? listEventFiles(dir) : [],
    };
  }

  /**
   * Builds the new file completely — schema and rally details — before
   * switching, so a failure leaves the server on the event it was running
   * rather than restarting into a half-made one.
   */
  async create({ name, date }: CreateEventDto): Promise<{ file: string }> {
    const dir = await this.switchableDir();
    const file = eventFileName(date, name);
    if (!file) {
      throw new BadRequestException(
        apiError(
          ApiErrorCode.EVENT_NAME_UNUSABLE,
          'The name has no usable characters',
        ),
      );
    }
    const path = join(dir, file);
    if (existsSync(path)) {
      throw new ConflictException(
        apiError(ApiErrorCode.EVENT_FILE_EXISTS, `${file} already exists`, {
          file,
        }),
      );
    }
    const target = new DataSource({
      type: 'better-sqlite3',
      database: path,
      // The lobby knows only RallyInfo; the restart's synchronize adds the rest.
      entities: this.dataSource?.entityMetadatas.map((m) => m.target) ?? [
        RallyInfo,
      ],
      synchronize: true,
    });
    try {
      await target.initialize();
      await target
        .getRepository(RallyInfo)
        .save({ id: RALLY_INFO_ID, name, date });
    } catch (err) {
      await target.destroy().catch(() => {});
      rmSync(path, { force: true });
      throw err;
    }
    await target.destroy();
    return this.switchTo(dir, file);
  }

  async open(file: string): Promise<{ file: string }> {
    const dir = await this.switchableDir();
    this.assertListed(dir, file);
    if (file === this.currentFile()) {
      return { file };
    }
    return this.switchTo(dir, file);
  }

  /** For good, with SQLite's side files. Never the open event. */
  delete(file: string): void {
    const dir = this.fixedDir();
    this.assertListed(dir, file);
    if (file === this.currentFile()) {
      throw new ConflictException(
        apiError(ApiErrorCode.EVENT_IS_OPEN, `${file} is open`, { file }),
      );
    }
    deleteEventFile(dir, file);
  }

  /**
   * A copy of an event file for download, in a temp file the caller
   * removes. Through SQLite's backup, never a raw copy: the open event may
   * be mid-write, and another file may have a journal to roll back.
   */
  async snapshot(file: string): Promise<string> {
    const dir = this.fixedDir();
    this.assertListed(dir, file);
    const target = tempPath();
    if (file === this.currentFile()) {
      const driver = this.dataSource?.driver as BetterSqlite3Driver;
      const db = driver.databaseConnection as Database.Database;
      await db.backup(target);
      return target;
    }
    const db = new Database(join(dir, file), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      await db.backup(target);
    } finally {
      db.close();
    }
    return target;
  }

  /**
   * Places an uploaded event file in the folder, not opened: opening is a
   * switch. Checked in a temp file first, so nothing that isn't a Rally
   * Gate event ever lands next to the real ones. The open event is never
   * replaced; another one only with `replace`.
   */
  async importEvent(
    body: Readable,
    uploadedName: string,
    replace: boolean,
    maxBytes = IMPORT_MAX_BYTES,
  ): Promise<{ file: string }> {
    const dir = this.fixedDir();
    const file = importFileName(uploadedName);
    if (!file) {
      throw new BadRequestException(
        apiError(
          ApiErrorCode.EVENT_NAME_UNUSABLE,
          'The name has no usable characters',
        ),
      );
    }
    if (file === this.currentFile()) {
      throw new ConflictException(
        apiError(ApiErrorCode.EVENT_IS_OPEN, `${file} is open`, { file }),
      );
    }
    if (!replace && existsSync(join(dir, file))) {
      throw new ConflictException(
        apiError(ApiErrorCode.EVENT_FILE_EXISTS, `${file} already exists`, {
          file,
        }),
      );
    }
    const temp = tempPath();
    try {
      await receive(body, temp, maxBytes);
      assertRallyGateEvent(temp);
      deleteEventFile(dir, file);
      // Copy, not rename: the temp folder may be on another drive.
      copyFileSync(temp, join(dir, file));
    } finally {
      rmSync(temp, { force: true });
    }
    return { file };
  }

  private assertListed(dir: string, file: string): void {
    if (!isEventFile(dir, file)) {
      throw new NotFoundException(
        apiError(ApiErrorCode.EVENT_FILE_NOT_FOUND, `No event file ${file}`, {
          file,
        }),
      );
    }
  }

  private currentFile(): string | null {
    return this.dataSource
      ? basename(String(this.dataSource.options.database))
      : null;
  }

  private fixedDir(): string {
    const dir = eventsDir();
    if (!dir) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.EVENT_FIXED_BY_CONFIG,
          "This server's event is fixed by its configuration (DB_PATH or Postgres)",
        ),
      );
    }
    return dir;
  }

  /**
   * Refused while a stage is live: gates publish at QoS 1 on a persistent
   * session, so a detection in flight across the restart is replayed on
   * reconnect — into the *new* event, missing from the one it belongs to.
   */
  private async switchableDir(): Promise<string> {
    const dir = this.fixedDir();
    if (await this.stages?.countBy({ status: StageStatus.ACTIVE })) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.CLOSE_STAGE_BEFORE_SWITCH,
          'Close the active stage before switching events',
        ),
      );
    }
    return dir;
  }

  private switchTo(dir: string, file: string): { file: string } {
    writeCurrentEventFile(dir, file);
    this.emitter.emit('app.restart');
    return { file };
  }
}

const tempPath = () => join(tmpdir(), `rally-gate-${randomUUID()}`);

/** Streams `body` into `path`, refusing past `maxBytes` mid-upload. */
async function receive(
  body: Readable,
  path: string,
  maxBytes: number,
): Promise<void> {
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      done(
        size > maxBytes
          ? new PayloadTooLargeException(
              apiError(
                ApiErrorCode.IMPORT_TOO_LARGE,
                `Larger than ${maxBytes} bytes`,
                { maxMb: Math.round(maxBytes / 1024 / 1024) },
              ),
            )
          : null,
        chunk,
      );
    },
  });
  await pipeline(body, limit, createWriteStream(path));
}

/** A SQLite file with Rally Gate's tables; anything else is refused. */
function assertRallyGateEvent(path: string): void {
  let ok = false;
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      ok = !!db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rally_info'",
        )
        .get();
    } finally {
      db.close();
    }
  } catch {
    // not a SQLite file at all
  }
  if (!ok) {
    throw new BadRequestException(
      apiError(ApiErrorCode.IMPORT_NOT_AN_EVENT, 'Not a Rally Gate event file'),
    );
  }
}
