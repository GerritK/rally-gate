import { ConflictException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiErrorCode, RallyStatus } from '@rally-gate/shared';
import { Repository } from 'typeorm';
import { apiError } from '../../common/api-error';
import { UpsertRallyInfoDto } from './dto';
import { RALLY_INFO_ID, RallyInfo } from './rally-info.entity';

@Injectable()
export class RallyInfoService {
  constructor(
    @InjectRepository(RallyInfo)
    private readonly rallyInfo: Repository<RallyInfo>,
    private readonly emitter: EventEmitter2,
  ) {}

  get(): Promise<RallyInfo | null> {
    return this.rallyInfo.findOneBy({ id: RALLY_INFO_ID });
  }

  /** SETUP while the rally details were never saved. */
  async status(): Promise<RallyStatus> {
    return (await this.get())?.status ?? RallyStatus.SETUP;
  }

  /** 409 while the rally is in one of `locked`, the reason as its code. */
  async assertNotIn(...locked: RallyStatus[]): Promise<void> {
    const status = await this.status();
    if (!locked.includes(status)) return;
    throw new ConflictException(
      status === RallyStatus.CLOSED
        ? apiError(
            ApiErrorCode.LOCKED_WHILE_CLOSED,
            'The rally is closed and its results are final; reopen it to change them',
          )
        : apiError(
            ApiErrorCode.LOCKED_WHILE_RUNNING,
            'Locked while the rally is running: it would change results already timed',
          ),
    );
  }

  async upsert(data: UpsertRallyInfoDto): Promise<RallyInfo> {
    await this.rallyInfo.save({ ...data, id: RALLY_INFO_ID });
    return this.emitUpdated();
  }

  async setStatus(status: RallyStatus): Promise<RallyInfo> {
    const name = (await this.get())?.name ?? '';
    await this.rallyInfo.save({ id: RALLY_INFO_ID, name, status });
    return this.emitUpdated();
  }

  private async emitUpdated(): Promise<RallyInfo> {
    const info = (await this.get()) as RallyInfo;
    this.emitter.emit('rally.updated', info);
    return info;
  }
}
