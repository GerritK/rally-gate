import { ConflictException, Injectable } from '@nestjs/common';
import {
  ApiErrorCode,
  RallyStatus,
  StageRunStatus,
  StageStatus,
} from '@rally-gate/shared';
import { apiError } from '../../common/api-error';
import { UpdateEntryDto } from '../entries/dto';
import { Entry } from '../entries/entry.entity';
import { StageRunsService } from '../stage-runs/stage-runs.service';
import { StagesService } from '../stages/stages.service';
import { RallyInfo } from './rally-info.entity';
import { RallyInfoService } from './rally-info.service';

/**
 * The rally's lifecycle. Apart from `RallyInfoService` because closing needs
 * the stages, and `StagesService` itself asks `RallyInfoService` before
 * activating one.
 */
@Injectable()
export class RallyStatusService {
  constructor(
    private readonly rallyInfo: RallyInfoService,
    private readonly stagesService: StagesService,
    private readonly stageRunsService: StageRunsService,
  ) {}

  /** The pre-start check is the dashboard's: it mostly warns, a marshal decides. */
  async start(): Promise<RallyInfo> {
    await this.assertStatus(RallyStatus.SETUP);
    return this.rallyInfo.setStatus(RallyStatus.RUNNING);
  }

  /**
   * Refused while a car is on stage: closing its stage would make it a DNF
   * nobody decided on. Closes the stages still running, which the dashboard
   * names before asking.
   */
  async close(): Promise<RallyInfo> {
    await this.assertStatus(RallyStatus.RUNNING);
    const active = (await this.stagesService.findAll()).filter(
      (s) => s.status === StageStatus.ACTIVE,
    );
    let onStage = 0;
    for (const stage of active) {
      onStage += (await this.stageRunsService.findAll(stage.id)).filter(
        (r) => r.status === StageRunStatus.STARTED,
      ).length;
    }
    if (onStage > 0) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.CARS_ON_STAGE,
          `${onStage} car(s) still on stage; finish or void them first`,
          { count: onStage },
        ),
      );
    }
    for (const stage of active) {
      await this.stagesService.close(stage.id);
    }
    return this.rallyInfo.setStatus(RallyStatus.CLOSED);
  }

  /** For a protest. There is no way back to SETUP. */
  async reopen(): Promise<RallyInfo> {
    await this.assertStatus(RallyStatus.CLOSED);
    return this.rallyInfo.setStatus(RallyStatus.RUNNING);
  }

  /**
   * Not a route lock, as only some fields are locked and a form sends them
   * all. Running: a car that has driven keeps its start number, every
   * printed result shows it. Closed: its status and classes too, as they
   * move it in or out of a ranking. Names and transponders stay open.
   */
  async assertEntryChangeAllowed(
    entry: Entry,
    patch: UpdateEntryDto,
  ): Promise<void> {
    const status = await this.rallyInfo.status();
    if (status === RallyStatus.SETUP) return;
    const renumbered =
      patch.startNumber !== undefined &&
      patch.startNumber !== entry.startNumber;
    if (status === RallyStatus.CLOSED) {
      const classIds = new Set(entry.classes.map((c) => c.id));
      const reclassed =
        patch.classIds !== undefined &&
        (new Set(patch.classIds).size !== classIds.size ||
          patch.classIds.some((id) => !classIds.has(id)));
      const restatused =
        patch.status !== undefined && patch.status !== entry.status;
      if (renumbered || reclassed || restatused) {
        await this.rallyInfo.assertNotIn(RallyStatus.CLOSED);
      }
      return;
    }
    if (
      renumbered &&
      (await this.stageRunsService.findAll()).some(
        (r) => r.entryId === entry.id,
      )
    ) {
      await this.rallyInfo.assertNotIn(RallyStatus.RUNNING);
    }
  }

  private async assertStatus(expected: RallyStatus): Promise<void> {
    const status = await this.rallyInfo.status();
    if (status !== expected) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.RALLY_STATUS_INVALID,
          `The rally is ${status}, not ${expected}`,
          { status },
        ),
      );
    }
  }
}
