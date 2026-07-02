import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue, Worker } from 'bullmq';
import { ClauseExtractionPipelineService } from './clause-extraction-pipeline.service';
import {
  CLAUSE_EXTRACTION_JOB,
  CLAUSE_EXTRACTION_QUEUE,
  type ClauseExtractionJobData,
} from './clause-extraction.constants';

/**
 * Producer + consumer for send-time clause pre-generation (grain-4).
 *
 * Mirrors `CompletionQueue`:
 * - When REDIS_URL is configured, `enqueue()` pushes a `document-clause-extract`
 *   job onto a BullMQ queue and a co-located `Worker` runs it (in this process)
 *   with retry/backoff. The job id is the document id, so a document can never
 *   be queued twice concurrently.
 * - When REDIS_URL is unset (or the queue can't be reached), it falls back to
 *   running the pipeline inline so pre-generation still happens locally.
 *   `enqueue()` never throws — a queueing problem must not break the sender's
 *   send response; the pipeline itself is retried by BullMQ (queued) or surfaced
 *   via logs (inline).
 */
@Injectable()
export class ClauseExtractionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClauseExtractionQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly pipeline: ClauseExtractionPipelineService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.log('REDIS_URL 미설정 — 조항 추출은 인라인으로 실행됩니다.');
      return;
    }

    try {
      const { Queue, Worker } = await import('bullmq');
      const connection = parseRedisConnection(redisUrl);

      // Producer: fail fast instead of buffering forever — `enqueue()` runs
      // inside the sender's HTTP response, so a down Redis must not hang it
      // (it falls back to inline). The worker keeps a blocking connection.
      this.queue = new Queue(CLAUSE_EXTRACTION_QUEUE, {
        connection: { ...connection, enableOfflineQueue: false },
      });
      this.worker = new Worker<ClauseExtractionJobData>(
        CLAUSE_EXTRACTION_QUEUE,
        async (job) => {
          await this.pipeline.runExtraction(job.data.documentId);
        },
        { connection, concurrency: 2 },
      );
      this.worker.on('failed', (job, err) => {
        this.logger.error(
          `조항 추출 실패 — 재시도됩니다 (docId=${job?.data?.documentId ?? '?'}, 시도 ${job?.attemptsMade ?? '?'}): ${String(err)}`,
        );
      });
      this.worker.on('completed', (job) => {
        this.logger.debug(`조항 추출 잡 완료: docId=${job.data.documentId}`);
      });
      this.logger.log('조항 추출 큐(BullMQ) + 워커가 활성화되었습니다.');
    } catch (err) {
      this.queue = null;
      this.worker = null;
      this.logger.warn(`조항 추출 큐 초기화 실패 — 인라인으로 대체합니다: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.worker = null;
    this.queue = null;
  }

  /**
   * Schedule clause pre-generation for a document. Never throws: if the queue is
   * unavailable it runs inline; inline failures are logged so the sender's send
   * response is unaffected.
   */
  async enqueue(documentId: string): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.add(
          CLAUSE_EXTRACTION_JOB,
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
        this.logger.warn(`조항 추출 큐 적재 실패 — 인라인으로 대체합니다: ${String(err)}`);
      }
    }
    await this.runInline(documentId);
  }

  /** Inline fallback — run the pipeline now, swallowing errors (logged). */
  private async runInline(documentId: string): Promise<void> {
    try {
      await this.pipeline.runExtraction(documentId);
    } catch (err) {
      this.logger.error(`조항 추출(인라인) 실패: docId=${documentId}: ${String(err)}`);
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
