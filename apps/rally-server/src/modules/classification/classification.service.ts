import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Placing,
  OverallPlacing,
  OverallStageTime,
  SplitPlacing,
  SplitGateInfo,
  StageOutcome,
  StageStatus,
  EntryStatus,
} from '@rally-gate/shared';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { GatesService } from '../gates/gates.service';
import {
  deriveStageRunStatus,
  StageRunsService,
} from '../stage-runs/stage-runs.service';
import { StagesService } from '../stages/stages.service';
import { SettingsService } from '../settings/settings.service';
import { Entry } from '../entries/entry.entity';
import { crewOf, EntriesService } from '../entries/entries.service';

export const NOTIONAL_PENALTY_MS_KEY = 'notionalPenaltyMs';

/**
 * Added on top of the slowest real time in the ranking being computed, which
 * is what keeps a notional worse than every real time in it. Roughly a stage
 * duration, deliberately not a token few seconds: with a small penalty a
 * quick crew can retire and still lead the rally. Tune per event via the
 * `notionalPenaltyMs` setting — the right value scales with stage length,
 * which this can't know.
 */
export const DEFAULT_NOTIONAL_PENALTY_MS = 120_000;

interface Rankable {
  entryId: string;
  durationMs: number;
}

@Injectable()
export class ClassificationService {
  constructor(
    private readonly stageRunsService: StageRunsService,
    private readonly stagesService: StagesService,
    private readonly entriesService: EntriesService,
    private readonly gatesService: GatesService,
    private readonly gateAssignmentsService: GateAssignmentsService,
    private readonly settingsService: SettingsService,
  ) {}

  async getStageClassification(
    stageId: string,
    classIds: string[] = [],
  ): Promise<Placing[]> {
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    const inClass = await this.rankable(classIds);
    const runs = await this.stageRunsService.findFinishedByStage(stageId);
    return this.rank(
      runs
        .filter((run) => inClass(run.entryId))
        .map((run) => ({
          entryId: run.entryId,
          durationMs: run.durationMs as number,
        })),
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
    const inClass = await this.rankable(classIds);
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
    const withdrawn = new Set(
      (await this.entriesService.findAll())
        .filter((entry) => entry.status === EntryStatus.WITHDRAWN)
        .map((entry) => entry.id),
    );
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

    const totals = new Map(
      classified.map((entryId) => [
        entryId,
        {
          durationMs: 0,
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

    const ranked = await this.rank(
      [...totals].map(([entryId, total]) => ({
        entryId,
        durationMs: total.durationMs,
      })),
    );
    return ranked.map((placing) => ({
      ...placing,
      stagesCompleted: totals.get(placing.entryId)!.stagesCompleted,
      stageTimes: totals.get(placing.entryId)!.stageTimes,
    }));
  }

  async getSplitGates(stageId: string): Promise<SplitGateInfo[]> {
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
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
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    const inClass = await this.rankable(classIds);
    const pairs = (
      await this.stageRunsService.findSplitsForStageAtIndex(stageId, splitIndex)
    ).filter((pair) => inClass(pair.run.entryId));
    const entries = await this.entriesService.findAll();
    const entryById = new Map<string, Entry>(
      entries.map((entry) => [entry.id, entry]),
    );
    const sorted = [...pairs].sort(
      (a, b) => a.split.elapsedMs - b.split.elapsedMs,
    );
    const leaderMs = sorted[0]?.split.elapsedMs ?? 0;
    const stageClosed = stage.status === StageStatus.CLOSED;
    return sorted.map((pair, index) => {
      const entry = entryById.get(pair.run.entryId);
      return {
        position: index + 1,
        entryId: pair.run.entryId,
        startNumber: entry?.startNumber ?? null,
        ...crewOf(entry),
        splitIndex,
        elapsedMs: pair.split.elapsedMs,
        gapMs: pair.split.elapsedMs - leaderMs,
        stageRunStatus: deriveStageRunStatus(pair.run, stageClosed),
      };
    });
  }

  async getNonFinishers(
    stageId: string,
    classIds: string[] = [],
  ): Promise<StageOutcome[]> {
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    const inClass = await this.classFilter(classIds);
    const runs = await this.stageRunsService.findByStage(stageId);
    const entries = await this.entriesService.findAll();
    const entryById = new Map<string, Entry>(
      entries.map((entry) => [entry.id, entry]),
    );
    const toOutcome = (
      entryId: string,
      outcome: StageOutcome['outcome'],
    ): StageOutcome => {
      const entry = entryById.get(entryId);
      return {
        entryId,
        startNumber: entry?.startNumber ?? null,
        ...crewOf(entry),
        outcome,
      };
    };

    const disqualified = new Set(
      entries
        .filter((entry) => entry.status === EntryStatus.DISQUALIFIED)
        .map((entry) => entry.id),
    );
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
  ): Promise<(entryId: string) => boolean> {
    const inClass = await this.classFilter(classIds);
    const disqualified = new Set(
      (await this.entriesService.findAll())
        .filter((entry) => entry.status === EntryStatus.DISQUALIFIED)
        .map((entry) => entry.id),
    );
    return (entryId) => inClass(entryId) && !disqualified.has(entryId);
  }

  /**
   * An unknown class is a 404, not an empty table — empty would read as
   * "nobody in this class has finished yet".
   */
  private async classFilter(
    classIds: string[],
  ): Promise<(entryId: string) => boolean> {
    if (classIds.length === 0) {
      return () => true;
    }
    for (const classId of classIds) {
      if (!(await this.entriesService.findClass(classId))) {
        throw new NotFoundException(`Class ${classId} not found`);
      }
    }
    const members = new Set(
      (await this.entriesService.findAll())
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
  private async rank(placings: Rankable[]): Promise<Placing[]> {
    const entries = await this.entriesService.findAll();
    const entryById = new Map<string, Entry>(
      entries.map((entry) => [entry.id, entry]),
    );
    const sorted = [...placings].sort((a, b) => a.durationMs - b.durationMs);
    const leaderMs = sorted[0]?.durationMs ?? 0;
    return sorted.map((placing, index) => {
      const entry = entryById.get(placing.entryId);
      return {
        position: index + 1,
        entryId: placing.entryId,
        startNumber: entry?.startNumber ?? null,
        ...crewOf(entry),
        durationMs: placing.durationMs,
        gapMs: placing.durationMs - leaderMs,
      };
    });
  }
}
