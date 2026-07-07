import { Injectable, NotFoundException } from '@nestjs/common';
import { ClassificationEntry, OverallClassificationEntry } from '@rally-gate/shared';
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
