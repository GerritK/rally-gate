import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './setting.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting)
    private readonly settings: Repository<Setting>,
  ) {}

  async get(key: string): Promise<string | null> {
    const setting = await this.settings.findOneBy({ key });
    return setting?.value ?? null;
  }

  async getBoolean(key: string, defaultValue: boolean): Promise<boolean> {
    const value = await this.get(key);
    return value === null ? defaultValue : value === 'true';
  }

  async set(key: string, value: string): Promise<Setting> {
    await this.settings.save({ key, value });
    return { key, value };
  }
}
