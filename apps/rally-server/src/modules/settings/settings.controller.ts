import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  NOTIONAL_PENALTY_MS_KEY,
  RallyStatus,
  START_ORDER_DIRECTION_KEY,
  START_ORDER_GROUPING_KEY,
  START_ORDER_KEY_KEY,
} from '@rally-gate/shared';
import { RallyInfoService } from '../rally-info/rally-info.service';
import { SetSettingDto } from './dto';
import { SettingsService } from './settings.service';
import { Public } from '../auth/auth.guard';

/** Per key, as one route stores them all: the start-order rules reorder
 *  stage start lists, the notional penalty moves every DNF/DNS's total. */
const LOCKED_WHEN: Record<string, RallyStatus[]> = {
  [START_ORDER_GROUPING_KEY]: [RallyStatus.RUNNING, RallyStatus.CLOSED],
  [START_ORDER_KEY_KEY]: [RallyStatus.RUNNING, RallyStatus.CLOSED],
  [START_ORDER_DIRECTION_KEY]: [RallyStatus.RUNNING, RallyStatus.CLOSED],
  [NOTIONAL_PENALTY_MS_KEY]: [RallyStatus.CLOSED],
};

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly rallyInfo: RallyInfoService,
  ) {}

  @Public()
  @Get(':key')
  async get(@Param('key') key: string) {
    const value = await this.settingsService.get(key);
    return value === null ? null : { key, value };
  }

  @Put(':key')
  async set(@Param('key') key: string, @Body() body: SetSettingDto) {
    await this.rallyInfo.assertNotIn(...(LOCKED_WHEN[key] ?? []));
    return this.settingsService.set(key, body.value);
  }
}
