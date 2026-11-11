import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiErrorCode,
  RallyStatus,
  StageRunStatus,
  StageScoring,
  StageStatus,
  StartMode,
} from '@rally-gate/shared';
import { Not, Repository } from 'typeorm';
import { apiError } from '../../common/api-error';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { RallyInfoService } from '../rally-info/rally-info.service';
import { writeClose } from './close-stage';
import { CreateStageDto, UpdateStageDto } from './dto';
import { Stage } from './stage.entity';

@Injectable()
export class StagesService {
  constructor(
    @InjectRepository(Stage)
    private readonly stages: Repository<Stage>,
    private readonly gateAssignmentsService: GateAssignmentsService,
    private readonly emitter: EventEmitter2,
    private readonly rallyInfo: RallyInfoService,
  ) {}

  findAll(): Promise<Stage[]> {
    return this.stages.find({ order: { stageNumber: 'ASC' } });
  }

  findOne(id: string): Promise<Stage | null> {
    return this.stages.findOneBy({ id });
  }

  async findOneOrFail(id: string): Promise<Stage> {
    const stage = await this.findOne(id);
    if (!stage) {
      throw new NotFoundException(
        apiError(ApiErrorCode.STAGE_NOT_FOUND, `Stage ${id} not found`),
      );
    }
    return stage;
  }

  async create(stage: CreateStageDto): Promise<Stage> {
    if (await this.findOne(stage.id)) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.STAGE_EXISTS,
          `Stage ${stage.id} already exists`,
          { stage: stage.id },
        ),
      );
    }
    await this.assertStageNumberFree(stage.stageNumber);
    assertNoShakedownTimetable(stage.id, stage.startMode, stage.scoring);
    await this.stages.save(stage);
    return this.findOne(stage.id) as Promise<Stage>;
  }

  /**
   * Editing is restricted to NOT_STARTED stages — once a stage is ACTIVE its
   * gates are live and StageRuns already reference it, and once CLOSED it's
   * terminal history; either way its name/number shouldn't shift underneath
   * runs already tied to it.
   */
  async update(id: string, data: UpdateStageDto): Promise<Stage> {
    const stage = await this.findOneOrFail(id);
    if (stage.status !== StageStatus.NOT_STARTED) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.STAGE_STARTED_NO_EDIT,
          `Stage ${id} is ${stage.status} and can only be edited while NOT_STARTED`,
          { stage: id },
        ),
      );
    }
    await this.assertStageNumberFree(data.stageNumber, id);
    assertNoShakedownTimetable(
      id,
      data.startMode ?? stage.startMode,
      data.scoring ?? stage.scoring,
    );
    const { firstStartTime, ...rest } = data;
    const firstStart =
      firstStartTime === undefined
        ? undefined
        : firstStartTime
          ? new Date(firstStartTime)
          : null;
    const changes = (a: Date | null | undefined, b: Date | null) =>
      a !== undefined && (a?.getTime() ?? null) !== (b?.getTime() ?? null);
    if (
      stage.startOrder &&
      (changes(firstStart, stage.firstStartTime) ||
        (data.slotIntervalMs !== undefined &&
          data.slotIntervalMs !== stage.slotIntervalMs))
    ) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.TIMETABLE_FROZEN,
          `Stage ${id}'s start list is frozen; unfreeze it to change first start or interval`,
          { stage: id },
        ),
      );
    }
    await this.stages.save({ ...rest, firstStartTime: firstStart, id });
    this.changed(id);
    return this.findOne(id) as Promise<Stage>;
  }

  /** Delay before activation: the posted times move, never silently. */
  async setFirstStartTime(id: string, firstStartTime: Date): Promise<void> {
    await this.stages.update(id, { firstStartTime });
  }

  /**
   * Deletion is restricted to NOT_STARTED stages — an ACTIVE/CLOSED stage may
   * already have StageRuns pointing at its id (no FK/cascade exists), so
   * deleting it would orphan history instead of a plan that was never used.
   */
  async remove(id: string): Promise<void> {
    const stage = await this.findOneOrFail(id);
    if (stage.status !== StageStatus.NOT_STARTED) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.STAGE_STARTED_NO_DELETE,
          `Stage ${id} is ${stage.status} and can only be deleted while NOT_STARTED`,
          { stage: id },
        ),
      );
    }
    await this.gateAssignmentsService.removeForStage(id);
    await this.stages.delete(id);
  }

  private async assertStageNumberFree(
    stageNumber: number,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.stages.findOneBy(
      excludeId ? { stageNumber, id: Not(excludeId) } : { stageNumber },
    );
    if (clash) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.STAGE_NUMBER_TAKEN,
          `Stage number ${stageNumber} is already used by stage ${clash.id}`,
          { stageNumber, stage: clash.id },
        ),
      );
    }
  }

  /**
   * Closing a stage also deactivates its gates — a closed stage shouldn't
   * keep recording detections against it (`EventsService` only checks
   * `GateAssignment.active`, not `Stage.status`). It writes DNF and DNS
   * with the status (`writeClose`), so results never derive them.
   */
  async close(id: string): Promise<Stage> {
    const stage = await this.findOneOrFail(id);
    const wasActive = stage.status === StageStatus.ACTIVE;
    await this.gateAssignmentsService.deactivateForStage(id);
    stage.status = StageStatus.CLOSED;
    const { saved, dnf, unstarted, dns } =
      await this.stages.manager.transaction((manager) =>
        writeClose(manager, stage),
      );
    for (const run of dnf) {
      this.emitter.emit('stage-run.updated', {
        ...run,
        dnf: true,
        status: StageRunStatus.DNF,
      });
    }
    for (const run of unstarted) {
      this.emitter.emit('stage-run.deleted', { id: run.id, stageId: id });
    }
    for (const row of dns) {
      this.emitter.emit('dns.changed', { ...row, dns: true });
    }
    // Only a stage that ran: a never-activated one's gates may be timing
    // another stage right now, and their passings belong to that one.
    if (wasActive) {
      const gateIds = (await this.gateAssignmentsService.findByStage(id)).map(
        (a) => a.gateId,
      );
      await this.emitter.emitAsync('stage.closed', { stageId: id, gateIds });
    }
    this.changed(id);
    return saved;
  }

  /**
   * Closing is terminal — a closed stage's gates cannot be reactivated
   * (see `docs/architecture.md` "Gate assignment: plan vs. live"). Fixing a
   * single missed/bad detection uses the stage-run correction endpoints
   * instead of reopening the whole stage. `Stage.status` becomes `ACTIVE`
   * here so it's the single source of truth for stage lifecycle, even
   * though the rule engine still reads per-gate `GateAssignment.active`.
   * When `force` bumps another stage off a shared gate, that stage is
   * closed (not just deactivated) — its gates are gone either way, so
   * anything still `STARTED` on it can never get a real finish detection
   * again; closing marks those DNF instead of leaving them stuck `STARTED`
   * forever (`close` writes them).
   *
   * Before Start rally only a stage outside the overall runs (shakedown,
   * qualifying), so a rally never starts unnoticed; once closed, none.
   */
  async activate(id: string, force: boolean): Promise<Stage> {
    const stage = await this.findOneOrFail(id);
    await this.rallyInfo.assertNotIn(RallyStatus.CLOSED);
    if (
      stage.scoring === StageScoring.OVERALL &&
      (await this.rallyInfo.status()) === RallyStatus.SETUP
    ) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.START_RALLY_FIRST,
          `Stage ${id} counts toward the overall; start the rally first`,
          { stage: id },
        ),
      );
    }
    if (stage.status === StageStatus.CLOSED) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.STAGE_CLOSED,
          `Stage ${id} is closed and cannot be reactivated`,
          { stage: id },
        ),
      );
    }
    assertHasFirstStart(stage);
    const { deactivatedStageIds } =
      await this.gateAssignmentsService.activateForStage(id, force);
    // ponytail: not one transaction — a crash mid-loop can leave a bumped
    // stage's GateAssignment rows deactivated but Stage.status still ACTIVE.
    // Wrap in a manager.transaction() if that's ever seen in practice.
    for (const bumpedStageId of deactivatedStageIds) {
      await this.close(bumpedStageId);
    }
    stage.status = StageStatus.ACTIVE;
    const saved = await this.stages.save(stage);
    // Awaited so the start order is frozen by the time the response arrives.
    await this.emitter.emitAsync('stage.activated', saved);
    // After the listeners: a timetable's slot runs exist by now.
    this.changed(id);
    return saved;
  }

  /** `null` unfreezes. */
  async setStartOrder(id: string, entryIds: string[] | null): Promise<void> {
    await this.stages.update(id, {
      startOrder: entryIds,
      startOrderFrozenAt: entryIds ? new Date() : null,
    });
    this.changed(id);
  }

  /**
   * Live timing and the public page reload the stage and its start order:
   * a slot time posted at the line must never be stale on another screen.
   */
  changed(stageId: string): void {
    this.emitter.emit('stage.changed', { stageId });
  }
}

/** Freezing or activating a timetable stage: its slots need a first start. */
export function assertHasFirstStart(stage: Stage): void {
  if (stage.startMode === StartMode.SLOT_SCHEDULE && !stage.firstStartTime) {
    throw new ConflictException(
      apiError(
        ApiErrorCode.NO_FIRST_START,
        `Stage ${stage.id} starts from a timetable but has no first start`,
        { stage: stage.id },
      ),
    );
  }
}

/** A timetable for unlimited runs means nothing. */
function assertNoShakedownTimetable(
  id: string,
  startMode: StartMode | undefined,
  scoring: StageScoring | undefined,
): void {
  if (startMode === StartMode.SLOT_SCHEDULE && scoring === StageScoring.NONE) {
    throw new ConflictException(
      apiError(
        ApiErrorCode.SLOTS_ON_SHAKEDOWN,
        `Stage ${id} is a shakedown; it can't start from a timetable`,
        { stage: id },
      ),
    );
  }
}

/** Closed and scored `OVERALL`: what the overall, and every total, reads. */
export function countsInOverall(stage: Stage): boolean {
  return (
    stage.status === StageStatus.CLOSED &&
    stage.scoring === StageScoring.OVERALL
  );
}
