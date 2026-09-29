import { Controller, Get } from '@nestjs/common';
import { VERSION } from '@rally-gate/shared';

@Controller()
export class AppController {
  @Get('version')
  version(): { version: string } {
    return { version: VERSION };
  }
}
