import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  isOutOfEvent,
  START_ORDER_DIRECTION_KEY,
  START_ORDER_GROUPING_KEY,
  START_ORDER_KEY_KEY,
  StageStatus,
  StartOrder,
  StartOrderDirection,
  StartOrderGrouping,
  StartOrderKey,
} from '@rally-gate/shared';
import { ClassificationService } from '../classification/classification.service';
import { SettingsService } from '../settings/settings.service';
import { Stage } from '../stages/stage.entity';
import { StagesService } from '../stages/stages.service';
import { Entry } from '../entries/entry.entity';
import {
  compareClassNames,
  crewOf,
  EntriesService,
} from '../entries/entries.service';

interface Group {
  classId: string | null;
  name: string | null;
  entries: Entry[];
}

/** See "Start order" in `docs/event-model.md`. */
@Injectable()
export class StartOrderService {
  private readonly logger = new Logger(StartOrderService.name);

  constructor(
    private readonly stagesService: StagesService,
    private readonly entriesService: EntriesService,
    private readonly classificationService: ClassificationService,
    private readonly settingsService: SettingsService,
  ) {}

  async getStartOrder(stageId: string): Promise<StartOrder> {
    const stage = await this.findStage(stageId);
    const entries = await this.entriesService.findAll();
    // A frozen list is the one posted and keeps every car it was posted
    // with, so positions don't shift; Live Timing shows one that has since
    // withdrawn as out. Anything still computed leaves such a car out.
    const eligible = entries.filter((v) => !isOutOfEvent(v.status));
    const ids = stage.startOrder ?? (await this.compute(stage, eligible));
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const listed = new Set(ids);
    const ordered = [
      ...ids.flatMap((id) => byId.get(id) ?? []),
      // Registered after the freeze; `findAll` is already by start number.
      ...eligible.filter((entry) => !listed.has(entry.id)),
    ];
    return {
      stageId,
      frozen: stage.startOrder !== null,
      frozenAt: stage.startOrderFrozenAt?.toISOString() ?? null,
      // ponytail: a frozen list reports today's grouping, not the one it was
      // frozen with. Only the presentation is off if the setting changed
      // since; store it alongside the snapshot if that ever matters.
      grouped: (await this.grouping()) === StartOrderGrouping.MAIN_CLASS,
      starters: ordered.map((entry, index) => ({
        position: index + 1,
        entryId: entry.id,
        startNumber: entry.startNumber,
        ...crewOf(entry),
        mainClassName: mainClassOf(entry)?.name ?? null,
      })),
    };
  }

  /**
   * Publishing the list: from here on it is the one posted, whatever later
   * corrections do to the times. Already frozen is a no-op, not a conflict.
   */
  async freeze(stageId: string): Promise<StartOrder> {
    const stage = await this.findStage(stageId);
    if (!stage.startOrder) {
      await this.snapshot(stage);
    }
    return this.getStartOrder(stageId);
  }

  /**
   * Only before activation: once a stage runs, its list is what starts are
   * measured against, so a wrongly posted list has to be fixed before then.
   */
  async unfreeze(stageId: string): Promise<StartOrder> {
    const stage = await this.findStage(stageId);
    if (stage.status !== StageStatus.NOT_STARTED) {
      throw new ConflictException(
        `Stage ${stageId} is ${stage.status}; its start order stays frozen`,
      );
    }
    await this.stagesService.setStartOrder(stageId, null);
    return this.getStartOrder(stageId);
  }

  /** A list frozen by hand beforehand is kept as published. */
  @OnEvent('stage.activated')
  async freezeOnActivation(stage: Stage): Promise<void> {
    if (stage.startOrder) {
      return;
    }
    try {
      await this.snapshot(stage);
    } catch (err) {
      // The emitter swallows handler errors. The list then stays computed
      // live, which the response shows as `frozen: false`.
      this.logger.error(`Freezing the start order of ${stage.id} failed`, err);
    }
  }

  private async findStage(stageId: string): Promise<Stage> {
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    return stage;
  }

  private async snapshot(stage: Stage): Promise<void> {
    const entries = (await this.entriesService.findAll()).filter(
      (v) => !isOutOfEvent(v.status),
    );
    await this.stagesService.setStartOrder(
      stage.id,
      await this.compute(stage, entries),
    );
  }

  private async compute(stage: Stage, entries: Entry[]): Promise<string[]> {
    const grouping = await this.grouping();
    const key = await this.setting(
      START_ORDER_KEY_KEY,
      StartOrderKey,
      StartOrderKey.START_NUMBER,
    );
    const direction = await this.setting(
      START_ORDER_DIRECTION_KEY,
      StartOrderDirection,
      StartOrderDirection.FASTEST_FIRST,
    );
    const sign = direction === StartOrderDirection.FASTEST_FIRST ? 1 : -1;

    const groups =
      grouping === StartOrderGrouping.NONE
        ? [{ classId: null, name: null, entries }]
        : groupByMainClass(entries);

    const ids: string[] = [];
    for (const group of groups) {
      const times = await this.timesFor(key, stage, group.classId);
      const sorted = [...group.entries].sort((a, b) => {
        const ta = times.get(a.id);
        const tb = times.get(b.id);
        if (ta !== undefined && tb !== undefined && ta !== tb) {
          return (ta - tb) * sign;
        }
        // No time goes last whatever the direction; ties by start number.
        if ((ta === undefined) !== (tb === undefined)) {
          return ta === undefined ? 1 : -1;
        }
        return a.startNumber - b.startNumber;
      });
      ids.push(...sorted.map((entry) => entry.id));
    }
    return ids;
  }

  /**
   * Overall time comes from the group's own class ranking: notionals depend
   * on the ranking, and the list has to agree with the class results.
   */
  private async timesFor(
    key: StartOrderKey,
    stage: Stage,
    classId: string | null,
  ): Promise<Map<string, number>> {
    let placings: { entryId: string; durationMs: number }[] = [];
    if (key === StartOrderKey.OVERALL_TIME) {
      placings = await this.classificationService.getOverallClassification(
        classId ? [classId] : [],
      );
    } else if (key === StartOrderKey.LAST_STAGE_TIME) {
      const previous = (await this.stagesService.findAll())
        .filter(
          (s) =>
            s.status === StageStatus.CLOSED &&
            s.stageNumber < stage.stageNumber,
        )
        .at(-1);
      if (previous) {
        placings = await this.classificationService.getStageClassification(
          previous.id,
        );
      }
    }
    return new Map(placings.map((e) => [e.entryId, e.durationMs]));
  }

  private grouping(): Promise<StartOrderGrouping> {
    return this.setting(
      START_ORDER_GROUPING_KEY,
      StartOrderGrouping,
      StartOrderGrouping.MAIN_CLASS,
    );
  }

  /** An unset or unknown value falls back to the default. */
  private async setting<T extends string>(
    key: string,
    values: Record<string, T>,
    defaultValue: T,
  ): Promise<T> {
    const value = await this.settingsService.get(key);
    return Object.values(values).find((v) => v === value) ?? defaultValue;
  }
}

/** The server allows several main classes per entry; the first by name counts. */
function mainClassOf(entry: Entry) {
  return entry.classes
    .filter((c) => c.main)
    .sort((a, b) => compareClassNames(a.name, b.name))[0];
}

/** Main classes alphabetically, entries without one last. */
function groupByMainClass(entries: Entry[]): Group[] {
  const groups = new Map<string | null, Group>();
  for (const entry of entries) {
    const mainClass = mainClassOf(entry);
    const classId = mainClass?.id ?? null;
    const group = groups.get(classId) ?? {
      classId,
      name: mainClass?.name ?? null,
      entries: [],
    };
    group.entries.push(entry);
    groups.set(classId, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.name === null
      ? 1
      : b.name === null
        ? -1
        : compareClassNames(a.name, b.name),
  );
}
