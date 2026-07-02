import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentExtractionService } from './document-extraction.service';
import { AiFieldAnalyzerService } from './ai-field-analyzer.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentExtractionService, AiFieldAnalyzerService],
  exports: [DocumentsService, DocumentExtractionService, AiFieldAnalyzerService],
})
export class DocumentsModule {}
