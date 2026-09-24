import { Module } from '@nestjs/common';
import { NtpService } from './ntp.service';

@Module({
  providers: [NtpService],
})
export class NtpModule {}
