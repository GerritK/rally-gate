import { Module } from '@nestjs/common';
import { GatesModule } from '../gates/gates.module';
import { BrokerService } from './broker.service';

@Module({
  imports: [GatesModule],
  providers: [BrokerService],
})
export class BrokerModule {}
