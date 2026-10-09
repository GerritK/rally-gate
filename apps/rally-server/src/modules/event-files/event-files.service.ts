import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiErrorCode, StageStatus } from '@rally-gate/shared';
import { existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { apiError } from '../../common/api-error';
import { RALLY_INFO_ID, RallyInfo } from '../rally-info/rally-info.entity';
import { Stage } from '../stages/stage.entity';
import { CreateEventDto } from './dto';
import {
  EventFile,
  eventFileName,
  eventsDir,
  isEventFile,
  listEventFiles,
  writeCurrentEventFile,
} from './event-files';

export interface EventInfo {
  /** The open event: a file name, or the Postgres database name. */
  file: string;
  switchable: boolean;
  events: EventFile[];
}

@Injectable()
export class EventFilesService {
  constructor(
    @InjectRepository(Stage)
    private readonly stages: Repository<Stage>,
    private readonly dataSource: DataSource,
    private readonly emitter: EventEmitter2,
  ) {}

  info(): EventInfo {
    const dir = eventsDir();
    return {
      file: this.currentFile(),
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
      entities: this.dataSource.entityMetadatas.map((m) => m.target),
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
    if (!isEventFile(dir, file)) {
      throw new NotFoundException(
        apiError(ApiErrorCode.EVENT_FILE_NOT_FOUND, `No event file ${file}`, {
          file,
        }),
      );
    }
    if (file === this.currentFile()) {
      return { file };
    }
    return this.switchTo(dir, file);
  }

  private currentFile(): string {
    return basename(String(this.dataSource.options.database));
  }

  /**
   * Refused while a stage is live: gates publish at QoS 1 on a persistent
   * session, so a detection in flight across the restart is replayed on
   * reconnect — into the *new* event, missing from the one it belongs to.
   */
  private async switchableDir(): Promise<string> {
    const dir = eventsDir();
    if (!dir) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.EVENT_FIXED_BY_CONFIG,
          "This server's event is fixed by its configuration (DB_PATH or Postgres)",
        ),
      );
    }
    if (await this.stages.countBy({ status: StageStatus.ACTIVE })) {
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
