import { Controller, Get, Param } from '@nestjs/common';
import { ClassificationService } from './classification.service';

@Controller('classification')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Get('overall')
  getOverall() {
    return this.classificationService.getOverallClassification();
  }

  @Get('stages/:stageId')
  getStage(@Param('stageId') stageId: string) {
    return this.classificationService.getStageClassification(stageId);
  }

  @Get('stages/:stageId/split-gates')
  getSplitGates(@Param('stageId') stageId: string) {
    return this.classificationService.getSplitGates(stageId);
  }

  @Get('stages/:stageId/splits/:splitIndex')
  getSplit(@Param('stageId') stageId: string, @Param('splitIndex') splitIndex: string) {
    return this.classificationService.getSplitClassification(stageId, Number(splitIndex));
  }
}
