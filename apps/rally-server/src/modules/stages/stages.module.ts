import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stage } from './stage.entity';
import { StagesController } from './stages.controller';
import { StagesService } from './stages.service';

@Module({
  imports: [TypeOrmModule.forFeature([Stage])],
  controllers: [StagesController],
  providers: [StagesService],
  exports: [StagesService],
})
export class StagesModule {}
