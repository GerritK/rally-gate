import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiErrorCode, StageStatus } from '@rally-gate/shared';
import { DataSource, Repository } from 'typeorm';
import { apiError } from '../../common/api-error';
import { isUniqueViolation } from '../../common/db-errors';
import { EntriesService } from '../entries/entries.service';
import { Stage } from '../stages/stage.entity';
import { StagesService } from '../stages/stages.service';
import { CreatePenaltyDto, PenaltyTypeDto } from './dto';
import { pricePenalties } from './penalty-pricing';
import { PenaltyType } from './penalty-type.entity';
import { Penalty } from './penalty.entity';

export type PricedPenalty = Penalty & { penaltyMs: number };

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
      (await this.stagesService.findAll()).map((stage) => stage.id),
    );
    return all
      .filter((penalty) => !entryId || penalty.entryId === entryId)
      .map((penalty) => ({ ...penalty, penaltyMs: prices.get(penalty.id)! }));
  }

  async create(dto: CreatePenaltyDto): Promise<PricedPenalty> {
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
    const { id } = await this.penalties.save(
      this.penalties.create({
        entryId: dto.entryId,
        stageId: dto.stageId ?? null,
        typeId: dto.typeId ?? null,
        count: dto.count ?? 1,
        seconds: dto.seconds ?? null,
        note: dto.note?.trim() || null,
        createdAt: new Date(),
      }),
    );
    return (await this.findAll(dto.entryId)).find((p) => p.id === id)!;
  }

  async remove(id: string): Promise<void> {
    const { affected } = await this.penalties.delete(id);
    if (!affected) {
      throw new NotFoundException(
        apiError(ApiErrorCode.PENALTY_NOT_FOUND, `Penalty ${id} not found`),
      );
    }
  }

  /**
   * What the overall adds per entry: penalties on closed stages (the
   * overall counts only those) and on no stage. Priced against all of them,
   * since one on a stage still running can come before one that counts.
   */
  async overallTotals(stages: Stage[]): Promise<Map<string, number>> {
    const closed = new Set(
      stages.filter((s) => s.status === StageStatus.CLOSED).map((s) => s.id),
    );
    const all = await this.penalties.find();
    const prices = pricePenalties(
      all,
      await this.findAllTypes(),
      stages.map((stage) => stage.id),
    );
    const totals = new Map<string, number>();
    for (const penalty of all) {
      if (penalty.stageId === null || closed.has(penalty.stageId)) {
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
