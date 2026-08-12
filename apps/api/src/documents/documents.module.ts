import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ScheduledSendQueue } from './scheduled-send.queue';
import { SCHEDULED_SEND_DISPATCHER } from './scheduled-send.constants';
import { SendQuotaModule } from '../common/send-quota.module';

@Module({
  imports: [SendQuotaModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    ScheduledSendQueue,
    // The scheduled-send worker calls back into DocumentsService via this token
    // (resolved lazily through ModuleRef) so the queue never takes a
    // constructor-time dependency on DocumentsService — that would be a cycle.
    { provide: SCHEDULED_SEND_DISPATCHER, useExisting: DocumentsService },
  ],
  // Export the queue so the send/reschedule/cancel endpoints (grain-3) can
  // schedule and remove delayed jobs.
  exports: [DocumentsService, ScheduledSendQueue],
})
export class DocumentsModule {}
