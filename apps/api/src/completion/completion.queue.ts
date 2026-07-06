import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue, Worker } from 'bullmq';
import { CompletionService } from './completion.service';
import {
  COMPLETION_JOB,
  COMPLETION_QUEUE,
  type CompletionJobData,
} from './completion.constants';

/**
 * Producer + consumer for the completion post-processing pipeline (grain-5).
 *
 * - When REDIS_URL is configured, `enqueue()` pushes a `document-completed` job
 *   onto a BullMQ queue and a co-located `Worker` runs it (in this process)
 *   with retry/backoff. The job id is the document id, so a document can never
 *   be queued twice concurrently.
 * - When REDIS_URL is unset (or the queue can't be reached), it falls back to
 *   running the pipeline inline so the signer flow still completes end-to-end
 *   locally. `enqueue()` never throws — a queueing problem must not break the
 *   signer's completion response; the pipeline itself is retried by BullMQ
 *   (queued) or surfaced via logs (inline).
 */
@Injectable()
export class CompletionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CompletionQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly completion: CompletionService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.log('REDIS_URL 미설정 — 완료 후처리는 인라인으로 실행됩니다.');
      return;
    }

    try {
      const { Queue, Worker } = await import('bullmq');
      const connection = parseRedisConnection(redisUrl);

      // Producer: fail fast instead of buffering forever — `enqueue()` runs
      // inside the signer's HTTP response, so a down Redis must not hang it
      // (it falls back to inline). The worker keeps a blocking connection.
      this.queue = new Queue(COMPLETION_QUEUE, {
        connection: { ...connection, enableOfflineQueue: false },
      });
      this.worker = new Worker<CompletionJobData>(
        COMPLETION_QUEUE,
        async (job) => {
          await this.completion.runPostProcessing(job.data.documentId);
        },
        { connection, concurrency: 2 },
      );
      this.worker.on('failed', (job, err) => {
        this.logger.error(
          `완료 후처리 실패 — 재시도됩니다 (docId=${job?.data?.documentId ?? '?'}, 시도 ${job?.attemptsMade ?? '?'}): ${String(err)}`,
        );
      });
      this.worker.on('completed', (job) => {
        this.logger.debug(`완료 후처리 잡 완료: docId=${job.data.documentId}`);
      });
      this.logger.log('완료 후처리 큐(BullMQ) + 워커가 활성화되었습니다.');
    } catch (err) {
      this.queue = null;
      this.worker = null;
      this.logger.warn(`완료 후처리 큐 초기화 실패 — 인라인으로 대체합니다: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.worker = null;
    this.queue = null;
  }

  /**
   * Schedule completion post-processing for a document. Never throws: if the
   * queue is unavailable it runs inline; inline failures are logged so the
   * signer's response is unaffected.
   */
  async enqueue(documentId: string): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.add(
          COMPLETION_JOB,
          { documentId },
          {
            // Dedupe concurrent enqueues for the same document.
            jobId: documentId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        );
        return;
      } catch (err) {
        this.logger.warn(`완료 후처리 큐 적재 실패 — 인라인으로 대체합니다: ${String(err)}`);
      }
    }
    await this.runInline(documentId);
  }

  /** Inline fallback — run the pipeline now, swallowing errors (logged). */
  private async runInline(documentId: string): Promise<void> {
    try {
      await this.completion.runPostProcessing(documentId);
    } catch (err) {
      this.logger.error(`완료 후처리(인라인) 실패: docId=${documentId}: ${String(err)}`);
    }
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
