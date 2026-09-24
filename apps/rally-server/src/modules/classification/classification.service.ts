import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ClassificationEntry,
  OverallClassificationEntry,
  SplitClassificationEntry,
  SplitGateInfo,
  StageOutcomeEntry,
  StageStatus,
  VehicleStatus,
} from '@rally-gate/shared';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { GatesService } from '../gates/gates.service';
import {
  deriveStageRunStatus,
  StageRunsService,
} from '../stage-runs/stage-runs.service';
import { StagesService } from '../stages/stages.service';
import { SettingsService } from '../settings/settings.service';
import { Vehicle } from '../vehicles/vehicle.entity';
import { VehiclesService } from '../vehicles/vehicles.service';

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

interface RankableEntry {
  vehicleId: string;
  durationMs: number;
}

@Injectable()
export class ClassificationService {
  constructor(
    private readonly stageRunsService: StageRunsService,
    private readonly stagesService: StagesService,
    private readonly vehiclesService: VehiclesService,
    private readonly gatesService: GatesService,
    private readonly gateAssignmentsService: GateAssignmentsService,
    private readonly settingsService: SettingsService,
  ) {}

  async getStageClassification(
    stageId: string,
  ): Promise<ClassificationEntry[]> {
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    const runs = await this.stageRunsService.findFinishedByStage(stageId);
    return this.rank(
      runs.map((run) => ({
        vehicleId: run.vehicleId,
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
   */
  async getOverallClassification(): Promise<OverallClassificationEntry[]> {
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
      (run) => closedStageIds.has(run.stageId),
    );
    // Classified = drove at least one closed stage. Without this a registered
    // car that never turned up would collect notional times for the whole
    // rally and appear in the results on an invented total. This set is also
    // the notional's population, which is what a future per-class ranking
    // narrows — hence notionals are computed per view, never stored on a run.
    const classified = [...new Set(finished.map((run) => run.vehicleId))];
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
      stageTimes.set(run.vehicleId, run.durationMs ?? 0);
      timesByStage.set(run.stageId, stageTimes);
    }

    const totals = new Map(
      classified.map((vehicleId) => [
        vehicleId,
        { durationMs: 0, stagesCompleted: 0 },
      ]),
    );
    for (const stageTimes of timesByStage.values()) {
      // A stage nobody finished never lands here: with no real time to
      // anchor a notional, every crew would get the same figure anyway.
      const notionalMs = Math.max(...stageTimes.values()) + notionalPenaltyMs;
      for (const vehicleId of classified) {
        const total = totals.get(vehicleId)!;
        const realMs = stageTimes.get(vehicleId);
        total.durationMs += realMs ?? notionalMs;
        if (realMs !== undefined) {
          total.stagesCompleted += 1;
        }
      }
    }

    const ranked = await this.rank(
      [...totals].map(([vehicleId, total]) => ({
        vehicleId,
        durationMs: total.durationMs,
      })),
    );
    return ranked.map((entry) => ({
      ...entry,
      stagesCompleted: totals.get(entry.vehicleId)!.stagesCompleted,
    }));
  }

  async getSplitGates(stageId: string): Promise<SplitGateInfo[]> {
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    const assignments =
      await this.gateAssignmentsService.findActiveSplitGatesForStage(stageId);
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
  ): Promise<SplitClassificationEntry[]> {
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    const pairs = await this.stageRunsService.findSplitsForStageAtIndex(
      stageId,
      splitIndex,
    );
    const vehicles = await this.vehiclesService.findAll();
    const vehicleById = new Map<string, Vehicle>(
      vehicles.map((vehicle) => [vehicle.id, vehicle]),
    );
    const sorted = [...pairs].sort(
      (a, b) => a.split.elapsedMs - b.split.elapsedMs,
    );
    const leaderMs = sorted[0]?.split.elapsedMs ?? 0;
    const stageClosed = stage.status === StageStatus.CLOSED;
    return sorted.map((pair, index) => {
      const vehicle = vehicleById.get(pair.run.vehicleId);
      return {
        position: index + 1,
        vehicleId: pair.run.vehicleId,
        startNumber: vehicle?.startNumber ?? '?',
        driverName: vehicle?.driverName ?? 'Unknown',
        coDriverName: vehicle?.coDriverName ?? undefined,
        splitIndex,
        elapsedMs: pair.split.elapsedMs,
        gapMs: pair.split.elapsedMs - leaderMs,
        stageRunStatus: deriveStageRunStatus(pair.run, stageClosed),
      };
    });
  }

  async getNonFinishers(stageId: string): Promise<StageOutcomeEntry[]> {
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    const runs = await this.stageRunsService.findByStage(stageId);
    const vehicles = await this.vehiclesService.findAll();
    const vehicleById = new Map<string, Vehicle>(
      vehicles.map((vehicle) => [vehicle.id, vehicle]),
    );
    const toEntry = (
      vehicleId: string,
      outcome: 'DNF' | 'DNS',
    ): StageOutcomeEntry => {
      const vehicle = vehicleById.get(vehicleId);
      return {
        vehicleId,
        startNumber: vehicle?.startNumber ?? '?',
        driverName: vehicle?.driverName ?? 'Unknown',
        coDriverName: vehicle?.coDriverName ?? undefined,
        outcome,
      };
    };

    if (stage.status !== StageStatus.CLOSED) {
      // Before the stage closes, an unfinished run is still running, not DNF,
      // and "no run yet" just means "hasn't started" — not DNS.
      return [];
    }
    const dnf = runs
      .filter((run) => !run.finishTime)
      .map((run) => toEntry(run.vehicleId, 'DNF'));
    const startedVehicleIds = new Set(runs.map((run) => run.vehicleId));
    const dns = vehicles
      .filter(
        (vehicle) =>
          !startedVehicleIds.has(vehicle.id) &&
          // A withdrawn or excluded car isn't a "did not start" — it wasn't
          // entered in the stage at all, so listing it alongside crews who
          // were due out and failed to appear misrepresents both.
          vehicle.status !== VehicleStatus.WITHDRAWN &&
          vehicle.status !== VehicleStatus.DISQUALIFIED,
      )
      .map((vehicle) => toEntry(vehicle.id, 'DNS'));
    return [...dnf, ...dns];
  }

  /**
   * Lowest total wins. Callers are responsible for handing in totals that
   * cover the same work — a single stage's runs, or overall totals already
   * padded with notional times — because a plain time sort is only correct
   * once that holds. See `getOverallClassification`.
   */
  private async rank(entries: RankableEntry[]): Promise<ClassificationEntry[]> {
    const vehicles = await this.vehiclesService.findAll();
    const vehicleById = new Map<string, Vehicle>(
      vehicles.map((vehicle) => [vehicle.id, vehicle]),
    );
    const sorted = [...entries].sort((a, b) => a.durationMs - b.durationMs);
    const leaderMs = sorted[0]?.durationMs ?? 0;
    return sorted.map((entry, index) => {
      const vehicle = vehicleById.get(entry.vehicleId);
      return {
        position: index + 1,
        vehicleId: entry.vehicleId,
        startNumber: vehicle?.startNumber ?? '?',
        driverName: vehicle?.driverName ?? 'Unknown',
        coDriverName: vehicle?.coDriverName ?? undefined,
        durationMs: entry.durationMs,
        gapMs: entry.durationMs - leaderMs,
      };
    });
  }
}
