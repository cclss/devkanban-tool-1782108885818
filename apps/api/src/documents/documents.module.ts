import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentExtractionService } from './document-extraction.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentExtractionService],
  exports: [DocumentsService, DocumentExtractionService],
})
export class DocumentsModule {}
