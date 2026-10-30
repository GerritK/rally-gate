import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiErrorCode,
  ChangeAction,
  StageStatus,
  type PenaltySnapshot,
} from '@rally-gate/shared';
import { DataSource, Repository } from 'typeorm';
import { apiError } from '../../common/api-error';
import { isUniqueViolation } from '../../common/db-errors';
import { recordChange } from '../changes/record-change';
import { EntriesService } from '../entries/entries.service';
import { Stage } from '../stages/stage.entity';
import { countsInOverall, StagesService } from '../stages/stages.service';
import { CreatePenaltyDto, PenaltyTypeDto } from './dto';
import { pricePenalties } from './penalty-pricing';
import { PenaltyType } from './penalty-type.entity';
import { Penalty } from './penalty.entity';

export type PricedPenalty = Penalty & { penaltyMs: number };

const penaltySnapshot = (penalty: Penalty): PenaltySnapshot => ({
  typeId: penalty.typeId,
  count: penalty.count,
  seconds: penalty.seconds,
  note: penalty.note,
});

@Injectable()
export class PenaltiesService {
  constructor(
    @InjectRepository(Penalty)
    private readonly penalties: Repository<Penalty>,
    @InjectRepository(PenaltyType)
    private readonly types: Repository<PenaltyType>,
    private readonly dataSource: DataSource,
    private readonly entriesService: EntriesService,
    private readonly stagesService: StagesService,
  ) {}

  findAllTypes(): Promise<PenaltyType[]> {
    return this.types.find({ order: { name: 'ASC' } });
  }

  createType(dto: PenaltyTypeDto): Promise<PenaltyType> {
    return this.saveType(this.types.create(dto));
  }

  async updateType(id: string, dto: PenaltyTypeDto): Promise<PenaltyType> {
    const type = await this.types.findOneBy({ id });
    if (!type) {
      throw new NotFoundException(
        apiError(
          ApiErrorCode.PENALTY_TYPE_NOT_FOUND,
          `Penalty type ${id} not found`,
        ),
      );
    }
    return this.saveType(Object.assign(type, dto));
  }

  /** Takes every penalty of the type with it. */
  async removeType(id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Penalty, { typeId: id });
      const { affected } = await manager.delete(PenaltyType, id);
      if (!affected) {
        throw new NotFoundException(
          apiError(
            ApiErrorCode.PENALTY_TYPE_NOT_FOUND,
            `Penalty type ${id} not found`,
          ),
        );
      }
    });
  }

  /** Priced against every penalty of the rally, whatever the filter. */
  async findAll(entryId?: string): Promise<PricedPenalty[]> {
    const all = await this.penalties.find();
    const prices = pricePenalties(
      all,
      await this.findAllTypes(),
      await this.stagesService.findAll(),
    );
    return all
      .filter((penalty) => !entryId || penalty.entryId === entryId)
      .map((penalty) => ({ ...penalty, penaltyMs: prices.get(penalty.id)! }));
  }

  async create(
    dto: CreatePenaltyDto,
    by: string | null,
  ): Promise<PricedPenalty> {
    if (!(await this.entriesService.findOne(dto.entryId))) {
      throw new NotFoundException(
        apiError(
          ApiErrorCode.ENTRY_NOT_FOUND,
          `Entry ${dto.entryId} not found`,
        ),
      );
    }
    if (dto.stageId) {
      // A stage can only be deleted while NOT_STARTED, so this also keeps
      // penalties from outliving their stage.
      const stage = await this.stagesService.findOneOrFail(dto.stageId);
      if (stage.status === StageStatus.NOT_STARTED) {
        throw new ConflictException(
          apiError(
            ApiErrorCode.STAGE_NOT_STARTED,
            `Stage ${stage.id} has not started`,
            { stage: stage.id },
          ),
        );
      }
    }
    if (dto.typeId) {
      if (!(await this.types.existsBy({ id: dto.typeId }))) {
        throw new NotFoundException(
          apiError(
            ApiErrorCode.PENALTY_TYPE_NOT_FOUND,
            `Penalty type ${dto.typeId} not found`,
          ),
        );
      }
      if (dto.seconds != null) {
        throw new BadRequestException(
          apiError(
            ApiErrorCode.TYPED_PENALTY_HAS_SECONDS,
            'A typed penalty is priced by its type',
          ),
        );
      }
    } else if (dto.seconds == null || !dto.note?.trim()) {
      throw new BadRequestException(
        apiError(
          ApiErrorCode.FREE_PENALTY_INCOMPLETE,
          'A free-text penalty needs seconds and a note',
        ),
      );
    }
    const { id } = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(Penalty, {
          entryId: dto.entryId,
          stageId: dto.stageId ?? null,
          typeId: dto.typeId ?? null,
          count: dto.count ?? 1,
          seconds: dto.seconds ?? null,
          note: dto.note?.trim() || null,
          createdAt: new Date(),
        }),
      );
      await recordChange(manager, by, {
        action: ChangeAction.PENALTY_ADDED,
        entryId: saved.entryId,
        stageId: saved.stageId,
        subjectId: saved.id,
        after: penaltySnapshot(saved),
      });
      return saved;
    });
    return (await this.findAll(dto.entryId)).find((p) => p.id === id)!;
  }

  async remove(id: string, by: string | null): Promise<void> {
    const penalty = await this.penalties.findOneBy({ id });
    if (!penalty) {
      throw new NotFoundException(
        apiError(ApiErrorCode.PENALTY_NOT_FOUND, `Penalty ${id} not found`),
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Penalty, id);
      await recordChange(manager, by, {
        action: ChangeAction.PENALTY_DELETED,
        entryId: penalty.entryId,
        stageId: penalty.stageId,
        subjectId: penalty.id,
        before: penaltySnapshot(penalty),
      });
    });
  }

  /**
   * What the overall adds per entry: penalties on stages it counts
   * (`countsInOverall`) and on no stage. Priced against all of them, since
   * one on a stage still running can come before one that counts.
   */
  async overallTotals(stages: Stage[]): Promise<Map<string, number>> {
    const counted = new Set(stages.filter(countsInOverall).map((s) => s.id));
    const all = await this.penalties.find();
    const prices = pricePenalties(all, await this.findAllTypes(), stages);
    const totals = new Map<string, number>();
    for (const penalty of all) {
      if (penalty.stageId === null || counted.has(penalty.stageId)) {
        totals.set(
          penalty.entryId,
          (totals.get(penalty.entryId) ?? 0) + prices.get(penalty.id)!,
        );
      }
    }
    return totals;
  }

  private async saveType(type: PenaltyType): Promise<PenaltyType> {
    const fromCounts = type.tiers.map((tier) => tier.fromCount);
    if (
      fromCounts[0] !== 1 ||
      fromCounts.some((n, i) => i > 0 && n <= fromCounts[i - 1])
    ) {
      throw new BadRequestException(
        apiError(
          ApiErrorCode.PENALTY_TIERS_INVALID,
          'Tiers must start at the 1st offence and ascend',
        ),
      );
    }
    try {
      return await this.types.save(type);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          apiError(
            ApiErrorCode.PENALTY_TYPE_EXISTS,
            `Penalty type ${type.name} already exists`,
            { name: type.name },
          ),
        );
      }
      throw err;
    }
  }
}
