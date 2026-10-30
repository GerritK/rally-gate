import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../auth/device.entity';
import { Invitation } from '../auth/invitation.entity';
import { ChangeRecord } from './change-record.entity';
import { ChangesController } from './changes.controller';

/** Writes go through `recordChange` in each module's own transaction. */
@Module({
  imports: [TypeOrmModule.forFeature([ChangeRecord, Device, Invitation])],
  controllers: [ChangesController],
})
export class ChangesModule {}
