import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentExtractionService } from './document-extraction.service';
import { AiFieldAnalyzerService } from './ai-field-analyzer.service';
import { DocxToPdfService } from './docx-to-pdf.service';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentExtractionService,
    AiFieldAnalyzerService,
    DocxToPdfService,
  ],
  exports: [DocumentsService, DocumentExtractionService, AiFieldAnalyzerService],
})
export class DocumentsModule {}
