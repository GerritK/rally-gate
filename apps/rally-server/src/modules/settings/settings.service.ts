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

  /**
   * Falls back to the default for an unset key *and* for an unparseable one.
   * The blank check is not redundant: `Number('')` is 0, not NaN, so an empty
   * value would otherwise pass as a legitimate zero.
   */
  async getNumber(key: string, defaultValue: number): Promise<number> {
    const value = (await this.get(key))?.trim();
    if (!value) {
      return defaultValue;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  async set(key: string, value: string): Promise<Setting> {
    await this.settings.save({ key, value });
    return { key, value };
  }
}
