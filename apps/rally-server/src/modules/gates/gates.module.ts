import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gate } from './gate.entity';
import { GatesController } from './gates.controller';
import { GatesService } from './gates.service';

@Module({
  imports: [TypeOrmModule.forFeature([Gate])],
  controllers: [GatesController],
  providers: [GatesService],
  exports: [GatesService],
})
export class GatesModule {}
