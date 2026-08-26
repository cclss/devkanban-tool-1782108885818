import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Worker } from 'bullmq';
import { DocumentsService } from './documents.service';
import {
  parseRedisConnection,
  SCHEDULED_SEND_QUEUE,
  type ScheduledSendJobData,
} from './scheduled-send.queue';

/** Executes delayed dispatches using the same send transaction as the HTTP API. */
@Injectable()
export class ScheduledSendWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledSendWorker.name);
  private worker: Worker | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) return;
    try {
      const { Worker } = await import('bullmq');
      this.worker = new Worker<ScheduledSendJobData>(
        SCHEDULED_SEND_QUEUE,
        (job) => this.documents.dispatchScheduled(job.data),
        { connection: parseRedisConnection(redisUrl), concurrency: 2 },
      );
      this.worker.on('failed', (job, err) => {
        this.logger.error(`예약 발송 실패: docId=${job?.data.documentId ?? '?'}: ${String(err)}`);
        // BullMQ emits `failed` for every failed attempt. Notify the sender
        // only after the configured retry budget is exhausted.
        const attempts = job?.opts.attempts ?? 1;
        if (job && job.attemptsMade >= attempts) {
          void this.documents.notifyScheduledDispatchFailed(job.data).catch((notifyErr) => {
            this.logger.error(
              `예약 발송 실패 알림 처리 실패: docId=${job.data.documentId}: ${String(notifyErr)}`,
            );
          });
        }
      });
    } catch (err) {
      this.worker = null;
      this.logger.error(`예약 발송 워커 초기화 실패: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    this.worker = null;
  }
}
