import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntryClass } from './entry-class.entity';
import { EntryClassesController } from './entry-classes.controller';
import { Entry } from './entry.entity';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';

@Module({
  imports: [TypeOrmModule.forFeature([Entry, EntryClass])],
  controllers: [EntriesController, EntryClassesController],
  providers: [EntriesService],
  exports: [EntriesService],
})
export class EntriesModule {}
