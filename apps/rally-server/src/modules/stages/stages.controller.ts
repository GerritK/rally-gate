import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Stage } from './stage.entity';
import { StagesService } from './stages.service';

@Controller('stages')
export class StagesController {
  constructor(private readonly stagesService: StagesService) {}

  @Get()
  findAll() {
    return this.stagesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stagesService.findOne(id);
  }

  @Post()
  create(@Body() stage: Stage) {
    return this.stagesService.create(stage);
  }

  /** Only NOT_STARTED stages can be edited — 409s for ACTIVE/CLOSED. */
  @Put(':id')
  update(@Param('id') id: string, @Body() stage: Omit<Stage, 'id'>) {
    return this.stagesService.update(id, stage);
  }

  /** Only NOT_STARTED stages can be deleted — 409s for ACTIVE/CLOSED. */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stagesService.remove(id);
  }

  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.stagesService.close(id);
  }

  /**
   * Makes this stage's gates live. Throws 409 with `{ conflictingStageIds }`
   * if another stage is currently active on a shared gate, unless
   * `?force=true` — then that other stage is closed instead. Also 409s
   * (plain message, no `conflictingStageIds`) if the stage is already
   * closed — closing is terminal.
   */
  @Post(':id/activate')
  activate(@Param('id') id: string, @Query('force') force?: string) {
    return this.stagesService.activate(id, force === 'true');
  }
}
