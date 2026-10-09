import { Controller, Get, Param, Post } from '@nestjs/common';
import { StartOrderService } from './start-order.service';

@Controller('stages/:id/start-order')
export class StartOrderController {
  constructor(private readonly startOrderService: StartOrderService) {}

  @Get()
  get(@Param('id') id: string) {
    return this.startOrderService.getStartOrder(id);
  }

  @Post('freeze')
  freeze(@Param('id') id: string) {
    return this.startOrderService.freeze(id);
  }

  /** 409 once the stage has been activated. */
  @Post('unfreeze')
  unfreeze(@Param('id') id: string) {
    return this.startOrderService.unfreeze(id);
  }
}
