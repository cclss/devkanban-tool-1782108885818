import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { SendQuotaModule } from '../common/send-quota.module';
import { ClauseSummaryModule } from '../clause-summary/clause-summary.module';

@Module({
  imports: [SendQuotaModule, ClauseSummaryModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
