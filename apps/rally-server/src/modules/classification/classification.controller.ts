import { Controller, Get, Param, Query } from '@nestjs/common';
import { ClassificationService } from './classification.service';

/** `?classId=a&classId=b` arrives as an array, a single one as a string. */
function toClassIds(classId?: string | string[]): string[] {
  return [classId ?? []].flat();
}

@Controller('classification')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Get('overall')
  getOverall(@Query('classId') classId?: string | string[]) {
    return this.classificationService.getOverallClassification(
      toClassIds(classId),
    );
  }

  @Get('stages/:stageId')
  getStage(
    @Param('stageId') stageId: string,
    @Query('classId') classId?: string | string[],
  ) {
    return this.classificationService.getStageClassification(
      stageId,
      toClassIds(classId),
    );
  }

  @Get('stages/:stageId/split-gates')
  getSplitGates(@Param('stageId') stageId: string) {
    return this.classificationService.getSplitGates(stageId);
  }

  @Get('stages/:stageId/splits/:splitIndex')
  getSplit(
    @Param('stageId') stageId: string,
    @Param('splitIndex') splitIndex: string,
    @Query('classId') classId?: string | string[],
  ) {
    return this.classificationService.getSplitClassification(
      stageId,
      Number(splitIndex),
      toClassIds(classId),
    );
  }

  @Get('stages/:stageId/non-finishers')
  getNonFinishers(
    @Param('stageId') stageId: string,
    @Query('classId') classId?: string | string[],
  ) {
    return this.classificationService.getNonFinishers(
      stageId,
      toClassIds(classId),
    );
  }
}
