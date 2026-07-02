import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ClausesModule } from '../clauses/clauses.module';

/**
 * Imports ClausesModule to enqueue send-time clause pre-generation (grain-4)
 * once the send transaction commits.
 */
@Module({
  imports: [ClausesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
