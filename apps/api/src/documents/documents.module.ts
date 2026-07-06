import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { SendQuotaModule } from '../common/send-quota.module';
import { FieldAnalysisModule } from '../field-analysis/field-analysis.module';

@Module({
  imports: [SendQuotaModule, FieldAnalysisModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
