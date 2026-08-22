import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RALLY_INFO_ID, RallyInfo } from './rally-info.entity';

@Injectable()
export class RallyInfoService {
  constructor(
    @InjectRepository(RallyInfo)
    private readonly rallyInfo: Repository<RallyInfo>,
  ) {}

  get(): Promise<RallyInfo | null> {
    return this.rallyInfo.findOneBy({ id: RALLY_INFO_ID });
  }

  async upsert(data: Omit<RallyInfo, 'id'>): Promise<RallyInfo> {
    await this.rallyInfo.save({ ...data, id: RALLY_INFO_ID });
    return this.get() as Promise<RallyInfo>;
  }
}
