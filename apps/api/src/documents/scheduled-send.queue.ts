import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

export const SCHEDULED_SEND_QUEUE = 'document-scheduled-send';
export const SCHEDULED_SEND_JOB = 'document-scheduled-send';

export interface ScheduledSendRecipient {
  email: string;
  name: string | null;
  order: number;
  index: number;
}

export interface ScheduledSendJobData {
  documentId: string;
  ownerId: string;
  jobId: string;
  recipients: ScheduledSendRecipient[];
}

/** BullMQ producer for persisted, delayed document dispatches. */
@Injectable()
export class ScheduledSendQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledSendQueue.name);
  private queue: Queue | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL 미설정 — 예약 발송을 사용할 수 없습니다.');
      return;
    }

    try {
      const { Queue } = await import('bullmq');
      this.queue = new Queue(SCHEDULED_SEND_QUEUE, {
        connection: { ...parseRedisConnection(redisUrl), enableOfflineQueue: false },
      });
    } catch (err) {
      this.queue = null;
      this.logger.error(`예약 발송 큐 초기화 실패: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
    this.queue = null;
  }

  async add(data: ScheduledSendJobData, scheduledFor: Date): Promise<void> {
    const queue = this.requireQueue();
    const delay = scheduledFor.getTime() - Date.now();
    if (delay <= 0) throw new ServiceUnavailableException('예약 발송 시각이 이미 지났어요.');
    await queue.add(SCHEDULED_SEND_JOB, data, {
      jobId: data.jobId,
      delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async replace(jobId: string, nextJobId: string, scheduledFor: Date): Promise<void> {
    const queue = this.requireQueue();
    const current = await queue.getJob(jobId);
    if (!current) throw new ServiceUnavailableException('예약 발송 잡을 찾을 수 없어요. 다시 예약해 주세요.');
    const nextJob = { ...current.data, jobId: nextJobId } as ScheduledSendJobData;
    await current.remove();
    try {
      const delay = scheduledFor.getTime() - Date.now();
      if (delay <= 0) throw new ServiceUnavailableException('예약 발송 시각이 이미 지났어요.');
      await queue.add(SCHEDULED_SEND_JOB, nextJob, {
        jobId: nextJob.jobId,
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    } catch (err) {
      // Best effort restore: the DB remains pointed at the old job until the
      // caller's update succeeds, so avoid silently losing a reservation.
      await queue.add(SCHEDULED_SEND_JOB, current.data, {
        jobId,
        delay: Math.max(0, current.opts.delay ?? 0),
      }).catch(() => undefined);
      throw err;
    }
  }

  async remove(jobId: string): Promise<void> {
    const job = await this.requireQueue().getJob(jobId);
    if (job) await job.remove();
  }

  private requireQueue(): Queue {
    if (!this.queue) {
      throw new ServiceUnavailableException('예약 발송 서비스를 지금 사용할 수 없어요. 잠시 후 다시 시도해 주세요.');
    }
    return this.queue;
  }
}

export function parseRedisConnection(redisUrl: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  maxRetriesPerRequest: null;
} {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}
