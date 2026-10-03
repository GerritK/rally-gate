import { Controller, Get } from '@nestjs/common';
import { VERSION } from '@rally-gate/shared';

@Controller()
export class AppController {
  @Get('version')
  version(): { version: string } {
    return { version: VERSION };
  }

  /** For the dashboard clock: the server's clock is the one gates sync to. */
  @Get('time')
  time(): { now: string } {
    return { now: new Date().toISOString() };
  }
}
