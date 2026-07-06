import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { SendQuotaModule } from '../common/send-quota.module';
import { FieldAnalysisModule } from '../field-analysis/field-analysis.module';
import { VisionTrialModule } from '../trials/vision-trial.module';

@Module({
  // VisionTrialModule: read-only trial balance for the field-suggestions status
  // (the atomic trial *consumption* still goes only through FieldAnalysisService).
  imports: [SendQuotaModule, FieldAnalysisModule, VisionTrialModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
