import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue, Worker } from 'bullmq';
import { ClauseSummaryService } from './clause-summary.service';
import {
  CLAUSE_SUMMARY_JOB,
  CLAUSE_SUMMARY_QUEUE,
  type ClauseSummaryJobData,
} from './clause-summary.constants';

/**
 * Producer + consumer for background clause-summary generation
 * (feature: AI 핵심 조항 카드).
 *
 * Mirrors the completion pipeline's queue/worker convention
 * (`completion.queue.ts`):
 * - When REDIS_URL is configured, `enqueue()` pushes a `generate-clause-summary`
 *   job onto a BullMQ queue and a co-located `Worker` runs it (in this process)
 *   with retry/backoff. The job id is the document id, so a document can never
 *   be queued twice concurrently.
 * - When REDIS_URL is unset (or the queue can't be reached), it falls back to
 *   running generation inline so summaries are still produced locally.
 *
 * `enqueue()` is strictly fire-and-forget and NEVER throws: it runs inside the
 * document send flow, and a queueing problem must not block or fail sending.
 * `ClauseSummaryService.generate` is itself no-throw (a failed summary leaves
 * `clauseSummary` null → the reader falls back to the plain viewer), so even
 * the inline path cannot surface an error to the caller.
 */
@Injectable()
export class ClauseSummaryQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClauseSummaryQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly clauseSummary: ClauseSummaryService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.log('REDIS_URL 미설정 — 클로즈 요약 생성은 인라인으로 실행됩니다.');
      return;
    }

    try {
      const { Queue, Worker } = await import('bullmq');
      const connection = parseRedisConnection(redisUrl);

      // Producer: fail fast instead of buffering forever — `enqueue()` runs
      // inside the send flow, so a down Redis must not hang it (it falls back
      // to inline). The worker keeps a blocking connection.
      this.queue = new Queue(CLAUSE_SUMMARY_QUEUE, {
        connection: { ...connection, enableOfflineQueue: false },
      });
      this.worker = new Worker<ClauseSummaryJobData>(
        CLAUSE_SUMMARY_QUEUE,
        async (job) => {
          await this.clauseSummary.generate(job.data.documentId);
        },
        { connection, concurrency: 2 },
      );
      this.worker.on('failed', (job, err) => {
        this.logger.error(
          `클로즈 요약 생성 실패 — 재시도됩니다 (docId=${job?.data?.documentId ?? '?'}, 시도 ${job?.attemptsMade ?? '?'}): ${String(err)}`,
        );
      });
      this.worker.on('completed', (job) => {
        this.logger.debug(`클로즈 요약 생성 잡 완료: docId=${job.data.documentId}`);
      });
      this.logger.log('클로즈 요약 생성 큐(BullMQ) + 워커가 활성화되었습니다.');
    } catch (err) {
      this.queue = null;
      this.worker = null;
      this.logger.warn(`클로즈 요약 큐 초기화 실패 — 인라인으로 대체합니다: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.worker = null;
    this.queue = null;
  }

  /**
   * Schedule clause-summary generation for a document. Fire-and-forget: NEVER
   * throws. If the queue is unavailable it runs inline; inline failures are
   * swallowed by `ClauseSummaryService.generate` (and logged) so the send flow
   * is unaffected.
   */
  async enqueue(documentId: string): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.add(
          CLAUSE_SUMMARY_JOB,
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
        this.logger.warn(`클로즈 요약 큐 적재 실패 — 인라인으로 대체합니다: ${String(err)}`);
      }
    }
    await this.runInline(documentId);
  }

  /** Inline fallback — generate now. `generate` never throws (logs on failure). */
  private async runInline(documentId: string): Promise<void> {
    try {
      await this.clauseSummary.generate(documentId);
    } catch (err) {
      // Defensive: generate() is already no-throw, but keep enqueue()'s
      // fire-and-forget contract absolute even if that ever changes.
      this.logger.error(`클로즈 요약(인라인) 생성 실패: docId=${documentId}: ${String(err)}`);
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
