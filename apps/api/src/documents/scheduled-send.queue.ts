import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { randomBytes } from 'crypto';
import type { Job, Queue, Worker } from 'bullmq';
import {
  SCHEDULED_SEND_DISPATCHER,
  SCHEDULED_SEND_JOB,
  SCHEDULED_SEND_QUEUE,
  type ScheduledSendDispatcher,
  type ScheduledSendJobData,
} from './scheduled-send.constants';

/** BullMQ retry budget for a fired scheduled-send job. */
const MAX_ATTEMPTS = 3;

/**
 * Producer + consumer for the scheduled-send (delayed-dispatch) pipeline
 * (grain-2), modelled on `CompletionQueue`.
 *
 * - When REDIS_URL is configured, `schedule()` pushes a `document-scheduled-send`
 *   job with a BullMQ `delay` and a co-located `Worker` fires it when the delay
 *   elapses, handing it back to `DocumentsService.dispatchScheduled` (which
 *   reuses the grain-1 `dispatchContract` core). The BullMQ job id is returned
 *   so the caller can persist it (`Document.scheduledJobId`) and later
 *   `remove()` / reschedule it.
 * - When REDIS_URL is unset it degrades to an in-memory `setTimeout` so local
 *   dev still auto-sends. This fallback is non-durable (a restart drops pending
 *   timers) — durable scheduling requires Redis, exactly like the completion
 *   pipeline's inline fallback.
 *
 * The worker never imports `DocumentsService`: it resolves the dispatcher lazily
 * via `ModuleRef` at fire time, so there is no constructor-time DI cycle with
 * `DocumentsService` (which depends on this queue to schedule/cancel).
 */
@Injectable()
export class ScheduledSendQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledSendQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  /**
   * In-memory fallback timers (REDIS_URL unset), keyed by the synthetic job id
   * returned from `schedule()` so `remove()` can cancel them.
   */
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly config: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.log(
        'REDIS_URL 미설정 — 예약 발송은 인메모리 타이머로 대체됩니다(로컬 전용, 재시작 시 유실).',
      );
      return;
    }

    try {
      const { Queue, Worker } = await import('bullmq');
      const connection = parseRedisConnection(redisUrl);

      // Producer fails fast (never buffers) so a down Redis surfaces to the
      // scheduling request instead of hanging it. Worker keeps a blocking conn.
      this.queue = new Queue(SCHEDULED_SEND_QUEUE, {
        connection: { ...connection, enableOfflineQueue: false },
      });
      this.worker = new Worker<ScheduledSendJobData>(
        SCHEDULED_SEND_QUEUE,
        async (job) => {
          await this.runDispatch(job.data);
        },
        { connection, concurrency: 2 },
      );
      this.worker.on('failed', (job, err) => {
        this.logger.error(
          `예약 발송 실패 (docId=${job?.data?.documentId ?? '?'}, 시도 ${job?.attemptsMade ?? '?'}): ${String(err)}`,
        );
        // Alert the sender only once the retry budget is exhausted.
        void this.handleFinalFailure(job, err);
      });
      this.worker.on('completed', (job) => {
        this.logger.debug(`예약 발송 잡 완료: docId=${job.data.documentId}`);
      });
      this.logger.log('예약 발송 큐(BullMQ) + 워커가 활성화되었습니다.');
    } catch (err) {
      this.queue = null;
      this.worker = null;
      this.logger.warn(
        `예약 발송 큐 초기화 실패 — 인메모리 타이머로 대체합니다: ${String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.worker = null;
    this.queue = null;
  }

  /**
   * Register a delayed auto-send. Returns the job id the caller must persist
   * (`Document.scheduledJobId`) so the send can later be cancelled/rescheduled.
   *
   * `delayMs` is clamped to a non-negative integer (a past instant fires ~now).
   */
  async schedule(
    documentId: string,
    delayMs: number,
    payload: Omit<ScheduledSendJobData, 'documentId'>,
  ): Promise<string> {
    const data: ScheduledSendJobData = { documentId, ...payload };
    const delay = Math.max(0, Math.floor(delayMs));

    if (this.queue) {
      const job = await this.queue.add(SCHEDULED_SEND_JOB, data, {
        delay,
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
      // BullMQ always assigns an id when none is supplied.
      return job.id as string;
    }

    return this.scheduleInMemory(data, delay);
  }

  /**
   * Remove a pending scheduled-send job by id. No-op (logged) if the job is
   * already gone — safe to call on cancel/reschedule regardless of queue state.
   */
  async remove(jobId: string): Promise<void> {
    // In-memory fallback timer?
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
      return;
    }

    if (this.queue) {
      try {
        const job = await this.queue.getJob(jobId);
        await job?.remove();
      } catch (err) {
        this.logger.warn(`예약 발송 잡 제거 실패 (jobId=${jobId}): ${String(err)}`);
      }
    }
  }

  // --- internals ----------------------------------------------------------

  /** In-memory (non-durable) fallback: fire the dispatch after `delay` ms. */
  private scheduleInMemory(data: ScheduledSendJobData, delay: number): string {
    const jobId = `local-${randomBytes(9).toString('hex')}`;
    const timer = setTimeout(() => {
      this.timers.delete(jobId);
      void this.runInline(data);
    }, delay);
    // A pending scheduled send must not, by itself, keep the process alive.
    timer.unref?.();
    this.timers.set(jobId, timer);
    return jobId;
  }

  /** The exact work the BullMQ worker runs on fire: hand off to the dispatcher. */
  private async runDispatch(data: ScheduledSendJobData): Promise<void> {
    await this.dispatcher().dispatchScheduled(data);
  }

  /** In-memory fallback runner: dispatch now, alerting the sender on failure. */
  private async runInline(data: ScheduledSendJobData): Promise<void> {
    try {
      await this.dispatcher().dispatchScheduled(data);
    } catch (err) {
      this.logger.error(
        `예약 발송(인메모리) 실패: docId=${data.documentId}: ${String(err)}`,
      );
      await this.dispatcher()
        .notifyScheduledSendFailure(data.documentId, String(err))
        .catch(() => undefined);
    }
  }

  /** Alert the sender once a BullMQ job has exhausted its retry budget. */
  private async handleFinalFailure(
    job: Job<ScheduledSendJobData> | undefined,
    err: Error,
  ): Promise<void> {
    if (!job) return;
    const attempts = job.opts?.attempts ?? MAX_ATTEMPTS;
    if ((job.attemptsMade ?? 0) < attempts) return; // more retries pending
    try {
      await this.dispatcher().notifyScheduledSendFailure(
        job.data.documentId,
        String(err),
      );
    } catch (notifyErr) {
      this.logger.error(
        `예약 발송 실패 알림 전송 실패 (docId=${job.data.documentId}): ${String(notifyErr)}`,
      );
    }
  }

  /** Lazily resolve the documents-layer dispatcher (avoids a DI cycle). */
  private dispatcher(): ScheduledSendDispatcher {
    return this.moduleRef.get<ScheduledSendDispatcher>(
      SCHEDULED_SEND_DISPATCHER,
      { strict: false },
    );
  }
}

/** Parse a redis:// URL into a BullMQ connection (blocking-client safe). */
function parseRedisConnection(redisUrl: string): {
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
    // BullMQ workers require this to be null (blocking commands).
    maxRetriesPerRequest: null,
  };
}
