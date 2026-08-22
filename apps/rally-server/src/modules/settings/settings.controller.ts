import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { SetSettingDto } from './dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get(':key')
  async get(@Param('key') key: string) {
    const value = await this.settingsService.get(key);
    return value === null ? null : { key, value };
  }

  @Put(':key')
  set(@Param('key') key: string, @Body() body: SetSettingDto) {
    return this.settingsService.set(key, body.value);
  }
}
