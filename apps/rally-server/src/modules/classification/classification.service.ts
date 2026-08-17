import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ClassificationEntry,
  OverallClassificationEntry,
  SplitClassificationEntry,
  StageOutcomeEntry,
  StageRunStatus,
  StageStatus,
} from '@rally-gate/shared';
import { GateAssignmentsService } from '../gates/gate-assignments.service';
import { GatesService } from '../gates/gates.service';
import { StageRunsService } from '../stage-runs/stage-runs.service';
import { StagesService } from '../stages/stages.service';
import { Vehicle } from '../vehicles/vehicle.entity';
import { VehiclesService } from '../vehicles/vehicles.service';

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
  ) {}

  async getStageClassification(stageId: string): Promise<ClassificationEntry[]> {
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    const runs = await this.stageRunsService.findFinishedByStage(stageId);
    return this.rank(runs.map((run) => ({ vehicleId: run.vehicleId, durationMs: run.durationMs as number })));
  }

  async getOverallClassification(): Promise<OverallClassificationEntry[]> {
    const runs = await this.stageRunsService.findAllFinished();
    const totals = new Map<string, { durationMs: number; stagesCompleted: number }>();
    for (const run of runs) {
      const totalsEntry = totals.get(run.vehicleId) ?? { durationMs: 0, stagesCompleted: 0 };
      totalsEntry.durationMs += run.durationMs ?? 0;
      totalsEntry.stagesCompleted += 1;
      totals.set(run.vehicleId, totalsEntry);
    }
    const ranked = await this.rank(
      Array.from(totals.entries()).map(([vehicleId, totalsEntry]) => ({
        vehicleId,
        durationMs: totalsEntry.durationMs,
      })),
    );
    return ranked.map((entry) => ({
      ...entry,
      stagesCompleted: totals.get(entry.vehicleId)!.stagesCompleted,
    }));
  }

  async getSplitGates(stageId: string) {
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    const assignments = await this.gateAssignmentsService.findActiveSplitGatesForStage(stageId);
    const gates = await this.gatesService.findAll();
    const gateById = new Map(gates.map((gate) => [gate.id, gate]));
    return assignments.map((assignment) => ({
      gateId: assignment.gateId,
      name: gateById.get(assignment.gateId)?.name ?? assignment.gateId,
      splitIndex: assignment.splitIndex ?? 0,
    }));
  }

  async getSplitClassification(stageId: string, splitIndex: number): Promise<SplitClassificationEntry[]> {
    const stage = await this.stagesService.findOne(stageId);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageId} not found`);
    }
    const pairs = await this.stageRunsService.findSplitsForStageAtIndex(stageId, splitIndex);
    const vehicles = await this.vehiclesService.findAll();
    const vehicleById = new Map<string, Vehicle>(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const sorted = [...pairs].sort((a, b) => a.split.elapsedMs - b.split.elapsedMs);
    const leaderMs = sorted[0]?.split.elapsedMs ?? 0;
    return sorted.map((pair, index) => {
      const vehicle = vehicleById.get(pair.run.vehicleId);
      return {
        position: index + 1,
        vehicleId: pair.run.vehicleId,
        startNumber: vehicle?.startNumber ?? '?',
        driverName: vehicle?.driverName ?? 'Unknown',
        coDriverName: vehicle?.coDriverName,
        splitIndex,
        elapsedMs: pair.split.elapsedMs,
        gapMs: pair.split.elapsedMs - leaderMs,
        stageRunStatus: pair.run.status,
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
    const vehicleById = new Map<string, Vehicle>(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const toEntry = (vehicleId: string, outcome: 'DNF' | 'DNS'): StageOutcomeEntry => {
      const vehicle = vehicleById.get(vehicleId);
      return {
        vehicleId,
        startNumber: vehicle?.startNumber ?? '?',
        driverName: vehicle?.driverName ?? 'Unknown',
        coDriverName: vehicle?.coDriverName,
        outcome,
      };
    };

    const dnf = runs.filter((run) => run.status === StageRunStatus.CANCELLED).map((run) => toEntry(run.vehicleId, 'DNF'));
    if (stage.status !== StageStatus.CLOSED) {
      // Before the stage closes, "no run yet" just means "hasn't started" — not DNS.
      return dnf;
    }
    const startedVehicleIds = new Set(runs.map((run) => run.vehicleId));
    const dns = vehicles.filter((vehicle) => !startedVehicleIds.has(vehicle.id)).map((vehicle) => toEntry(vehicle.id, 'DNS'));
    return [...dnf, ...dns];
  }

  private async rank(entries: RankableEntry[]): Promise<ClassificationEntry[]> {
    const vehicles = await this.vehiclesService.findAll();
    const vehicleById = new Map<string, Vehicle>(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const sorted = [...entries].sort((a, b) => a.durationMs - b.durationMs);
    const leaderMs = sorted[0]?.durationMs ?? 0;
    return sorted.map((entry, index) => {
      const vehicle = vehicleById.get(entry.vehicleId);
      return {
        position: index + 1,
        vehicleId: entry.vehicleId,
        startNumber: vehicle?.startNumber ?? '?',
        driverName: vehicle?.driverName ?? 'Unknown',
        coDriverName: vehicle?.coDriverName,
        durationMs: entry.durationMs,
        gapMs: entry.durationMs - leaderMs,
      };
    });
  }
}
