import { Module } from '@nestjs/common';
import { BrokerService } from './broker.service';

@Module({
  providers: [BrokerService],
})
export class BrokerModule {}
