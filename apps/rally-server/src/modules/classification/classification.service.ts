import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ApiErrorCode,
  Crew,
  DEFAULT_NOTIONAL_PENALTY_MS,
  NOTIONAL_PENALTY_MS_KEY,
  Placing,
  OverallPlacing,
  OverallStageTime,
  SplitPlacing,
  SplitGateInfo,
  StageOutcome,
  StageStatus,
  EntryStatus,
} from '@rally-gate/shared';
import { apiError } from '../../common/api-error';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { GatesService } from '../gates/gates.service';
import {
  deriveStageRunStatus,
  StageRunsService,
} from '../stage-runs/stage-runs.service';
import { StagesService } from '../stages/stages.service';
import { SettingsService } from '../settings/settings.service';
import { PenaltiesService } from '../penalties/penalties.service';
import { Entry } from '../entries/entry.entity';
import { crewOf, EntriesService } from '../entries/entries.service';

interface Rankable {
  entryId: string;
  durationMs: number;
}

type Row = { entryId: string; startNumber: number | null } & Crew;

/** Who a result row is about, as every listing carries it. */
function rowOf(entries: Map<string, Entry>, entryId: string): Row {
  const entry = entries.get(entryId);
  return { entryId, startNumber: entry?.startNumber ?? null, ...crewOf(entry) };
}

function byId(entries: Entry[]): Map<string, Entry> {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function idsWithStatus(entries: Entry[], status: EntryStatus): Set<string> {
  return new Set(entries.filter((e) => e.status === status).map((e) => e.id));
}

/**
 * Every public method loads the entries once and hands them down: the
 * helpers below each used to load them again.
 */
@Injectable()
export class ClassificationService {
  constructor(
    private readonly stageRunsService: StageRunsService,
    private readonly stagesService: StagesService,
    private readonly entriesService: EntriesService,
    private readonly gatesService: GatesService,
    private readonly gateAssignmentsService: GateAssignmentsService,
    private readonly settingsService: SettingsService,
    private readonly penaltiesService: PenaltiesService,
  ) {}

  async getStageClassification(
    stageId: string,
    classIds: string[] = [],
  ): Promise<Placing[]> {
    await this.stagesService.findOneOrFail(stageId);
    const entries = await this.entriesService.findAll();
    const inClass = await this.rankable(classIds, entries);
    const runs = await this.stageRunsService.findFinishedByStage(stageId);
    return this.rank(
      runs
        .filter((run) => inClass(run.entryId))
        .map((run) => ({
          entryId: run.entryId,
          durationMs: run.durationMs as number,
        })),
      entries,
    );
  }

  /**
   * Overall standings: every counted stage contributes a time for every
   * classified crew, so totals are comparable and the lowest one wins. A crew
   * that didn't complete a stage gets a **notional time** (see "Notional
   * times" in `docs/event-model.md`) rather than simply a shorter total —
   * otherwise retiring early would look like winning.
   *
   * Only **CLOSED** stages count, the same trigger `getNonFinishers` uses: a
   * stage still running has no result to penalise anyone against. So the
   * overall table moves when a stage closes, not continuously during one.
   *
   * With `classIds`, runs are narrowed to entries in *all* of those classes
   * (Stock + Rookie + 2WD) *before* anything else, so who is classified,
   * which stages count and every notional are all taken from within that
   * group, not borrowed from the overall field.
   */
  async getOverallClassification(
    classIds: string[] = [],
  ): Promise<OverallPlacing[]> {
    const entries = await this.entriesService.findAll();
    const inClass = await this.rankable(classIds, entries);
    const stages = await this.stagesService.findAll();
    const closedStageIds = new Set(
      stages
        .filter((stage) => stage.status === StageStatus.CLOSED)
        .map((stage) => stage.id),
    );
    if (closedStageIds.size === 0) {
      return [];
    }

    const finished = (await this.stageRunsService.findAllFinished()).filter(
      (run) => closedStageIds.has(run.stageId) && inClass(run.entryId),
    );
    // Classified = drove at least one closed stage. Without this a registered
    // car that never turned up would collect notional times for the whole
    // rally and appear in the results on an invented total. This set is also
    // the notional's population, which a class ranking narrows — hence
    // notionals are computed per view, never stored on a run.
    //
    // A withdrawn car is retired: not classified, so it collects no
    // notionals for the stages it won't drive. Its real times stay in
    // `finished` and still anchor the others' notionals, so a withdrawal
    // never moves anyone else's total.
    const withdrawn = idsWithStatus(entries, EntryStatus.WITHDRAWN);
    const classified = [
      ...new Set(
        finished
          .map((run) => run.entryId)
          .filter((entryId) => !withdrawn.has(entryId)),
      ),
    ];
    if (classified.length === 0) {
      return [];
    }

    const notionalPenaltyMs = await this.settingsService.getNumber(
      NOTIONAL_PENALTY_MS_KEY,
      DEFAULT_NOTIONAL_PENALTY_MS,
    );

    const timesByStage = new Map<string, Map<string, number>>();
    for (const run of finished) {
      const stageTimes =
        timesByStage.get(run.stageId) ?? new Map<string, number>();
      stageTimes.set(run.entryId, run.durationMs ?? 0);
      timesByStage.set(run.stageId, stageTimes);
    }

    // Added to the total only, never to a stage time: a stage's results
    // show what was driven, and the notionals anchor on that too.
    const penaltyTotals = await this.penaltiesService.overallTotals(stages);
    const totals = new Map(
      classified.map((entryId) => [
        entryId,
        {
          durationMs: penaltyTotals.get(entryId) ?? 0,
          penaltyMs: penaltyTotals.get(entryId) ?? 0,
          stagesCompleted: 0,
          stageTimes: [] as OverallStageTime[],
        },
      ]),
    );
    // `stages` is in stage order, so each crew's stageTimes are too. A stage
    // nobody finished never lands in timesByStage: with no real time to
    // anchor a notional, every crew would get the same figure anyway.
    for (const stage of stages) {
      const stageTimes = timesByStage.get(stage.id);
      if (!stageTimes) continue;
      const notionalMs = Math.max(...stageTimes.values()) + notionalPenaltyMs;
      for (const entryId of classified) {
        const total = totals.get(entryId)!;
        const realMs = stageTimes.get(entryId);
        total.durationMs += realMs ?? notionalMs;
        if (realMs !== undefined) {
          total.stagesCompleted += 1;
        }
        total.stageTimes.push({
          stageId: stage.id,
          durationMs: realMs ?? notionalMs,
          notional: realMs === undefined,
        });
      }
    }

    const ranked = this.rank(
      [...totals].map(([entryId, total]) => ({
        entryId,
        durationMs: total.durationMs,
      })),
      entries,
    );
    return ranked.map((placing) => ({
      ...placing,
      stagesCompleted: totals.get(placing.entryId)!.stagesCompleted,
      stageTimes: totals.get(placing.entryId)!.stageTimes,
      penaltyMs: totals.get(placing.entryId)!.penaltyMs,
    }));
  }

  async getSplitGates(stageId: string): Promise<SplitGateInfo[]> {
    await this.stagesService.findOneOrFail(stageId);
    const assignments =
      await this.gateAssignmentsService.findSplitGatesForStage(stageId);
    const gates = await this.gatesService.findAll();
    const gateById = new Map(gates.map((gate) => [gate.id, gate]));
    return assignments.map((assignment) => ({
      gateId: assignment.gateId,
      name: gateById.get(assignment.gateId)?.name ?? assignment.gateId,
      splitIndex: assignment.splitIndex ?? 0,
    }));
  }

  async getSplitClassification(
    stageId: string,
    splitIndex: number,
    classIds: string[] = [],
  ): Promise<SplitPlacing[]> {
    const stage = await this.stagesService.findOneOrFail(stageId);
    const entries = await this.entriesService.findAll();
    const inClass = await this.rankable(classIds, entries);
    const pairs = (
      await this.stageRunsService.findSplitsForStageAtIndex(stageId, splitIndex)
    ).filter((pair) => inClass(pair.run.entryId));
    const entryById = byId(entries);
    const sorted = [...pairs].sort(
      (a, b) => a.split.elapsedMs - b.split.elapsedMs,
    );
    const leaderMs = sorted[0]?.split.elapsedMs ?? 0;
    const stageClosed = stage.status === StageStatus.CLOSED;
    return sorted.map((pair, index) => ({
      position: index + 1,
      ...rowOf(entryById, pair.run.entryId),
      splitIndex,
      elapsedMs: pair.split.elapsedMs,
      gapMs: pair.split.elapsedMs - leaderMs,
      stageRunStatus: deriveStageRunStatus(pair.run, stageClosed),
    }));
  }

  async getNonFinishers(
    stageId: string,
    classIds: string[] = [],
  ): Promise<StageOutcome[]> {
    const stage = await this.stagesService.findOneOrFail(stageId);
    const entries = await this.entriesService.findAll();
    const inClass = await this.classFilter(classIds, entries);
    const runs = await this.stageRunsService.findByStage(stageId);
    const entryById = byId(entries);
    const toOutcome = (
      entryId: string,
      outcome: StageOutcome['outcome'],
    ): StageOutcome => ({ ...rowOf(entryById, entryId), outcome });

    const disqualified = idsWithStatus(entries, EntryStatus.DISQUALIFIED);
    // Off every ranking (see `rankable`), so listed here wherever it drove,
    // whether the stage still runs or not: a decision, not a pending result.
    const dsq = [...new Set(runs.map((run) => run.entryId))]
      .filter((entryId) => disqualified.has(entryId))
      .map((entryId) => toOutcome(entryId, 'DSQ'));

    if (stage.status !== StageStatus.CLOSED) {
      // Before the stage closes, an unfinished run is still running, not DNF,
      // and "no run yet" just means "hasn't started" — not DNS.
      return dsq.filter((row) => inClass(row.entryId));
    }
    const dnf = runs
      .filter((run) => !run.finishTime && !disqualified.has(run.entryId))
      .map((run) => toOutcome(run.entryId, 'DNF'));
    const startedEntryIds = new Set(runs.map((run) => run.entryId));
    const dns = entries
      .filter(
        (entry) =>
          !startedEntryIds.has(entry.id) &&
          // A withdrawn or excluded car isn't a "did not start" — it wasn't
          // entered in the stage at all, so listing it alongside crews who
          // were due out and failed to appear misrepresents both.
          entry.status !== EntryStatus.WITHDRAWN &&
          entry.status !== EntryStatus.DISQUALIFIED,
      )
      .map((entry) => toOutcome(entry.id, 'DNS'));
    return [...dnf, ...dns, ...dsq].filter((row) => inClass(row.entryId));
  }

  /**
   * Who is ranked: in all the classes asked for, and not disqualified. A
   * disqualified car's times leave every result, the notional times the
   * others are charged included, as if it had never run; the stage's
   * non-finishers list it as DSQ instead.
   */
  private async rankable(
    classIds: string[],
    entries: Entry[],
  ): Promise<(entryId: string) => boolean> {
    const inClass = await this.classFilter(classIds, entries);
    const disqualified = idsWithStatus(entries, EntryStatus.DISQUALIFIED);
    return (entryId) => inClass(entryId) && !disqualified.has(entryId);
  }

  /**
   * An unknown class is a 404, not an empty table — empty would read as
   * "nobody in this class has finished yet".
   */
  private async classFilter(
    classIds: string[],
    entries: Entry[],
  ): Promise<(entryId: string) => boolean> {
    if (classIds.length === 0) {
      return () => true;
    }
    for (const classId of classIds) {
      if (!(await this.entriesService.findClass(classId))) {
        throw new NotFoundException(
          apiError(ApiErrorCode.CLASS_NOT_FOUND, `Class ${classId} not found`),
        );
      }
    }
    const members = new Set(
      entries
        .filter((entry) =>
          classIds.every((id) => entry.classes.some((c) => c.id === id)),
        )
        .map((entry) => entry.id),
    );
    return (entryId) => members.has(entryId);
  }

  /**
   * Lowest total wins. Callers are responsible for handing in totals that
   * cover the same work — a single stage's runs, or overall totals already
   * padded with notional times — because a plain time sort is only correct
   * once that holds. See `getOverallClassification`.
   */
  private rank(placings: Rankable[], entries: Entry[]): Placing[] {
    const entryById = byId(entries);
    const sorted = [...placings].sort((a, b) => a.durationMs - b.durationMs);
    const leaderMs = sorted[0]?.durationMs ?? 0;
    return sorted.map((placing, index) => ({
      position: index + 1,
      ...rowOf(entryById, placing.entryId),
      durationMs: placing.durationMs,
      gapMs: placing.durationMs - leaderMs,
    }));
  }
}
