import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

export type NotificationChannel = 'alimtalk' | 'email';

export interface NotificationJob {
  channel: NotificationChannel;
  to: string;
  /** Recipient display name, when known. */
  toName?: string | null;
  template: string;
  /** Template variables (signing link, sender name, etc.). */
  data: Record<string, unknown>;
}

export const NOTIFICATIONS_QUEUE = 'notifications';

/**
 * Enqueues outbound alimtalk / email notifications.
 *
 * - When REDIS_URL is configured, jobs are pushed onto a BullMQ queue for a
 *   worker (a later grain / separate process) to deliver via Kakao / SES.
 * - When it is not set (or the queue can't be reached), it degrades to a
 *   console log so the sender flow still completes end-to-end locally.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private queue: Queue | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.log('REDIS_URL 미설정 — 알림은 콘솔 로그로 대체됩니다.');
      return;
    }

    try {
      const { Queue } = await import('bullmq');
      const url = new URL(redisUrl);
      this.queue = new Queue(NOTIFICATIONS_QUEUE, {
        connection: {
          host: url.hostname,
          port: Number(url.port || 6379),
          // Fail fast instead of buffering forever if Redis is unreachable.
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
        },
      });
      this.logger.log('알림 큐(BullMQ)가 활성화되었습니다.');
    } catch (err) {
      this.queue = null;
      this.logger.warn(`알림 큐 초기화 실패 — 콘솔 로그로 대체합니다: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  /** Enqueue (or log) a batch of notifications. Never throws to the caller. */
  async enqueueMany(jobs: NotificationJob[]): Promise<void> {
    await Promise.all(jobs.map((job) => this.enqueue(job)));
  }

  async enqueue(job: NotificationJob): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.add(job.channel, job, {
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        });
        return;
      } catch (err) {
        this.logger.warn(`알림 큐 적재 실패 — 콘솔 로그로 대체합니다: ${String(err)}`);
      }
    }
    this.logConsoleFallback(job);
  }

  private logConsoleFallback(job: NotificationJob): void {
    this.logger.log(
      `[알림 폴백] ${job.channel} → ${job.to} (${job.toName ?? '이름없음'}) ` +
        `template=${job.template} data=${JSON.stringify(job.data)}`,
    );
  }
}
