import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { GatePairingService } from './gate-pairing.service';

/** Changes are the organiser's alone (`docs/auth.md` "Gates"). */
@Controller('gate-pairing')
export class GatePairingController {
  constructor(private readonly pairing: GatePairingService) {}

  @Get()
  state() {
    return this.pairing.state();
  }

  /** Opens pairing for 10 minutes, again from now if it is open. */
  @Post()
  open() {
    return this.pairing.open();
  }

  @Post(':gateId')
  accept(@Param('gateId') gateId: string) {
    return this.pairing.accept(gateId);
  }

  @Delete(':gateId')
  reject(@Param('gateId') gateId: string) {
    return this.pairing.reject(gateId);
  }
}
