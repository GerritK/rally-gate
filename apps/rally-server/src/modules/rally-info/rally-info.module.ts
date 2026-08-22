import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RallyInfo } from './rally-info.entity';
import { RallyInfoController } from './rally-info.controller';
import { RallyInfoService } from './rally-info.service';

@Module({
  imports: [TypeOrmModule.forFeature([RallyInfo])],
  controllers: [RallyInfoController],
  providers: [RallyInfoService],
})
export class RallyInfoModule {}
