import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { SendQuotaModule } from '../common/send-quota.module';
import { ScheduledSendQueue } from './scheduled-send.queue';
import { ScheduledSendWorker } from './scheduled-send.worker';

@Module({
  imports: [SendQuotaModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, ScheduledSendQueue, ScheduledSendWorker],
  exports: [DocumentsService],
})
export class DocumentsModule {}
