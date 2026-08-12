import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomInt } from 'crypto';
import {
  DocumentStatus,
  Prisma,
  SignRequestStatus,
  type Document,
} from '@repo/db';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService, type NotificationJob } from '../notifications/notifications.service';
import { MESSAGES } from '../common/messages';
import { SendQuotaService } from '../common/send-quota.service';
import { DOCUMENT_STATUS_LABEL } from './document-status';
import {
  countPendingSigners,
  deriveNextAction,
  deriveUrgency,
  type NextAction,
  type Urgency,
} from './document-todo';
import {
  artifactFilename,
  type CompletionArtifact,
} from '../completion/artifact';
import type {
  ScheduledSendDispatcher,
  ScheduledSendJobData,
  ScheduledSendRecipient,
} from './scheduled-send.constants';
import { ScheduledSendQueue } from './scheduled-send.queue';
import type { CreateDocumentDto, SaveFieldsDto, SendContractDto } from './dto/documents.dto';

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB

@Injectable()
export class DocumentsService implements ScheduledSendDispatcher {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly sendQuota: SendQuotaService,
    private readonly scheduledSend: ScheduledSendQueue,
  ) {}

  /** Multipart upload path: validate the PDF, persist bytes, create a DRAFT. */
  async uploadAndCreate(
    ownerId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
    ip?: string,
  ): Promise<DocumentSummary> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException(MESSAGES.document.emptyFile);
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new BadRequestException(MESSAGES.document.fileTooLarge);
    }

    // Multer decodes multipart field values (incl. the file name) as latin1, so
    // a UTF-8 name (한글·이모지 등) arrives as mojibake. Normalize it once up
    // front and feed the corrected name to every downstream step — type check,
    // storage key, and title — so they all agree on the same value.
    const originalname = this.normalizeUploadFilename(file.originalname);

    if (!this.looksLikePdf({ ...file, originalname })) {
      throw new BadRequestException(MESSAGES.document.invalidFileType);
    }

    const pageCount = await this.countPdfPages(file.buffer);
    const storageKey = this.storage.buildKey(ownerId, originalname);
    await this.storage.save(storageKey, file.buffer);

    const title = this.deriveTitle(originalname);
    const document = await this.prisma.document.create({
      data: { ownerId, title, storageKey, pageCount },
    });

    await this.writeAudit({
      documentId: document.id,
      actorId: ownerId,
      action: 'DOCUMENT_UPLOADED',
      ip,
      metadata: { title, pageCount, storageKey },
    });

    // Fresh DRAFT: no recipients yet, so no pending signers.
    return this.toSummary(document, 0, 0, new Date());
  }

  /** Presigned-upload path: client already PUT the bytes; just register it. */
  async createFromStorageKey(
    ownerId: string,
    dto: CreateDocumentDto,
    ip?: string,
  ): Promise<DocumentSummary> {
    let pageCount = dto.pageCount ?? 0;
    if (!pageCount) {
      try {
        const bytes = await this.storage.read(dto.storageKey);
        pageCount = await this.countPdfPages(bytes);
      } catch {
        // Bytes may not be readable yet (e.g. S3 eventual consistency). The
        // frontend can pass pageCount explicitly; default to 0 otherwise.
        pageCount = dto.pageCount ?? 0;
      }
    }

    const document = await this.prisma.document.create({
      data: { ownerId, title: dto.title, storageKey: dto.storageKey, pageCount },
    });

    await this.writeAudit({
      documentId: document.id,
      actorId: ownerId,
      action: 'DOCUMENT_UPLOADED',
      ip,
      metadata: { title: dto.title, pageCount, storageKey: dto.storageKey, via: 'presigned' },
    });

    // Fresh DRAFT: no recipients yet, so no pending signers.
    return this.toSummary(document, 0, 0, new Date());
  }

  /** Replace the placed sign fields for a draft document. */
  async saveFields(ownerId: string, documentId: string, dto: SaveFieldsDto): Promise<{ count: number }> {
    const document = await this.requireOwnedDocument(ownerId, documentId);
    if (document.status !== DocumentStatus.DRAFT) {
      throw new BadRequestException(MESSAGES.send.alreadySent);
    }

    const count = await this.prisma.$transaction(async (tx) => {
      await tx.signField.deleteMany({ where: { documentId } });
      if (dto.fields.length === 0) return 0;
      const created = await tx.signField.createMany({
        data: dto.fields.map((f) => ({
          documentId,
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          recipientIndex: f.recipientIndex ?? 0,
        })),
      });
      return created.count;
    });

    return { count };
  }

  /**
   * Dispatch the contract: enforce the Free-plan quota, create one SignRequest
   * per recipient, map fields to recipients, flip the document to 진행 중,
   * write the audit trail, and enqueue notifications.
   */
  async send(
    ownerId: string,
    documentId: string,
    dto: SendContractDto,
    ip?: string,
  ): Promise<DocumentSummary> {
    const document = await this.requireOwnedDocument(ownerId, documentId);
    if (document.status !== DocumentStatus.DRAFT) {
      throw new BadRequestException(MESSAGES.send.alreadySent);
    }

    const fieldCount = await this.prisma.signField.count({ where: { documentId } });
    if (fieldCount === 0) {
      throw new BadRequestException(MESSAGES.send.noFields);
    }

    // Normalize recipient order: explicit `order` wins, else input order. Done
    // before the schedule/immediate split so both paths dispatch to the exact
    // same normalized list (the scheduled list travels with the delayed job).
    const recipients = dto.recipients.map((r, i) => ({
      email: r.email.toLowerCase().trim(),
      name: r.name?.trim() || null,
      order: r.order ?? i,
      index: i,
    }));

    const now = new Date();
    const scheduledSendAt = this.resolveScheduledSendAt(dto.scheduledSendAt, now);

    // Deferred send: register a delayed job and park the document as 예약됨
    // instead of dispatching now. No SignRequests/notifications are created yet —
    // that happens when the job fires (`dispatchScheduled` → `dispatchContract`).
    if (scheduledSendAt) {
      return this.scheduleContract(document, recipients, scheduledSendAt, ownerId, now, ip);
    }

    await this.sendQuota.assertWithinQuota(ownerId);

    const { updated, recipientCount } = await this.dispatchContract(
      document,
      recipients,
      ownerId,
      ip,
    );

    // Just sent: every recipient's request was created PENDING, so all of them
    // are still-pending signers.
    return this.toSummary(updated, recipientCount, recipientCount, now);
  }

  /**
   * Parse and validate the optional reservation instant from the send DTO.
   * Returns `null` when no schedule was requested (immediate send), the parsed
   * `Date` when a valid future instant was supplied, and throws a
   * design-spec-toned `BadRequestException` otherwise:
   *   - unparseable / non-ISO value → `MESSAGES.send.scheduledInvalid`
   *   - an instant at or before `now` → `MESSAGES.send.scheduledInPast`
   *
   * `now` is injected by the caller so the past-check and the eventual job delay
   * are computed against the same instant (no drift between the two reads).
   */
  private resolveScheduledSendAt(raw: string | undefined, now: Date): Date | null {
    if (raw === undefined || raw === null) return null;

    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) {
      throw new BadRequestException(MESSAGES.send.scheduledInvalid);
    }
    if (when.getTime() <= now.getTime()) {
      throw new BadRequestException(MESSAGES.send.scheduledInPast);
    }
    return when;
  }

  /**
   * Queue a contract for a future auto-send (the deferred branch of `send`).
   *
   * Registers a delayed job FIRST, then persists SCHEDULED + the reservation
   * instant + the returned job id. Ordering matters: if the DB write failed after
   * the job was registered, the orphan job would fire and find the row still
   * DRAFT — `dispatchScheduled`'s status guard no-ops it, so nothing double-sends.
   * The reverse order (persist, then schedule) could strand a SCHEDULED row with
   * no job. The recipients captured now travel with the job (Redis-durable) so the
   * fire-time dispatch needs no re-derivation. This writes an audit entry but does
   * NOT dispatch or notify — recipients hear nothing until the job actually fires.
   */
  private async scheduleContract(
    document: Document,
    recipients: ScheduledSendRecipient[],
    scheduledSendAt: Date,
    ownerId: string,
    now: Date,
    ip?: string,
  ): Promise<DocumentSummary> {
    const documentId = document.id;
    const delayMs = scheduledSendAt.getTime() - now.getTime();

    const jobId = await this.scheduledSend.schedule(documentId, delayMs, {
      ownerId,
      recipients,
      ip,
    });

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.SCHEDULED,
        scheduledSendAt,
        scheduledJobId: jobId,
      },
    });

    await this.writeAudit({
      documentId,
      actorId: ownerId,
      action: 'CONTRACT_SCHEDULED',
      ip,
      metadata: {
        scheduledSendAt: scheduledSendAt.toISOString(),
        scheduledJobId: jobId,
        recipientCount: recipients.length,
        recipients: recipients.map((r) => ({ email: r.email, order: r.order })),
      },
    });

    // Not dispatched yet: no SignRequests exist, so there are no pending signers.
    // `recipientCount` echoes the planned recipients so the caller can confirm
    // what was queued.
    return this.toSummary(updated, recipients.length, 0, now);
  }

  /**
   * Change the reservation instant of an already-SCHEDULED contract
   * (`PATCH /documents/:id/schedule`). Owner-gated and SCHEDULED-only: only a
   * pending reservation can be moved. The new instant is validated (future, ISO)
   * with the same `resolveScheduledSendAt` used by `send`, so the rejection copy
   * matches.
   *
   * The recipients captured at the original schedule time travel with the job
   * (Redis-durable, no DB column), so we `peek()` the pending job to recover them,
   * remove the old job, register a fresh delayed job under the new delay, then
   * persist the new instant + job id.
   *
   * Ordering — remove old → schedule new → persist — is chosen so a crash never
   * lets the contract auto-send at the *old* (possibly earlier) time: once the old
   * job is gone, the worst case is a briefly stranded SCHEDULED row with no job
   * (recoverable via cancel/reschedule), never a wrongful early send. If the DB
   * write fails after the new job is registered, that job fires on the still-
   * SCHEDULED row at the new time and dispatches correctly (the stale DB instant is
   * cosmetic). No dispatch/notifications happen here — recipients still hear
   * nothing until the job fires.
   */
  async reschedule(
    ownerId: string,
    documentId: string,
    dto: { scheduledSendAt: string },
    ip?: string,
  ): Promise<DocumentSummary> {
    const document = await this.requireOwnedDocument(ownerId, documentId);
    if (document.status !== DocumentStatus.SCHEDULED) {
      throw new BadRequestException(MESSAGES.send.notScheduled);
    }

    const now = new Date();
    const scheduledSendAt = this.resolveScheduledSendAt(dto.scheduledSendAt, now);
    // The DTO makes the instant required, so `resolveScheduledSendAt` only returns
    // null for an absent value that class-validation already rejects; guard anyway
    // so a valid future Date is guaranteed below.
    if (!scheduledSendAt) {
      throw new BadRequestException(MESSAGES.send.scheduledInvalid);
    }

    const previousJobId = document.scheduledJobId;
    // Recover the recipients from the pending job before removing it. If the job is
    // gone (e.g. a non-durable fallback timer lost to a restart) we cannot rebuild
    // the recipient list — steer the sender to cancel and re-create the schedule.
    const payload = previousJobId
      ? await this.scheduledSend.peek(previousJobId)
      : null;
    if (!payload) {
      throw new BadRequestException(MESSAGES.send.scheduleUnavailable);
    }

    if (previousJobId) {
      await this.scheduledSend.remove(previousJobId);
    }

    const delayMs = scheduledSendAt.getTime() - now.getTime();
    const jobId = await this.scheduledSend.schedule(documentId, delayMs, payload);

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: { scheduledSendAt, scheduledJobId: jobId },
    });

    await this.writeAudit({
      documentId,
      actorId: ownerId,
      action: 'CONTRACT_RESCHEDULED',
      ip,
      metadata: {
        scheduledSendAt: scheduledSendAt.toISOString(),
        scheduledJobId: jobId,
        previousJobId,
        recipientCount: payload.recipients.length,
      },
    });

    return this.toSummary(updated, payload.recipients.length, 0, now);
  }

  /**
   * Cancel a pending reservation (`DELETE /documents/:id/schedule`): return the
   * contract to DRAFT, clear the reservation columns, and remove the delayed job.
   * Owner-gated and SCHEDULED-only.
   *
   * Ordering — persist DRAFT → remove job — is chosen so the send can never slip
   * through after a cancel: the status flips to DRAFT first, so even if the job
   * removal fails (or a fired job races the removal), `dispatchScheduled`'s
   * SCHEDULED-only guard no-ops it. The leftover job, if any, is harmless.
   */
  async cancelSchedule(
    ownerId: string,
    documentId: string,
    ip?: string,
  ): Promise<DocumentSummary> {
    const document = await this.requireOwnedDocument(ownerId, documentId);
    if (document.status !== DocumentStatus.SCHEDULED) {
      throw new BadRequestException(MESSAGES.send.notScheduled);
    }

    const now = new Date();
    const jobId = document.scheduledJobId;

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.DRAFT,
        scheduledSendAt: null,
        scheduledJobId: null,
      },
    });

    if (jobId) {
      await this.scheduledSend.remove(jobId);
    }

    await this.writeAudit({
      documentId,
      actorId: ownerId,
      action: 'CONTRACT_SCHEDULE_CANCELLED',
      ip,
      metadata: { previousJobId: jobId },
    });

    // Back to DRAFT: no queued send, no pending signers.
    return this.toSummary(updated, 0, 0, now);
  }

  /**
   * The actual dispatch of a contract, factored out of `send` so both the
   * immediate-send path and the future scheduled-send worker can reuse the exact
   * same mechanics: create one SignRequest per recipient, map fields to
   * recipients, flip the document to 진행 중 (IN_PROGRESS), write the audit trail,
   * and enqueue recipient notifications.
   *
   * This deliberately does NOT re-validate ownership/status/field-count — those
   * are entry-point concerns the caller owns (immediate send checks a DRAFT; the
   * scheduled worker checks a SCHEDULED doc). The Free-plan quota IS re-checked
   * inside the transaction to keep the immediate-send behaviour identical and
   * avoid a race past the limit.
   *
   * Returns the updated document row and the recipient count so the caller can
   * shape the API summary. Behaviour is unchanged from the previous inline path.
   */
  private async dispatchContract(
    document: Document,
    recipients: Array<{
      email: string;
      name: string | null;
      order: number;
      index: number;
    }>,
    ownerId: string,
    ip?: string,
  ): Promise<{ updated: Document; recipientCount: number }> {
    const documentId = document.id;
    const webOrigin = this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';

    const result = await this.prisma.$transaction(async (tx) => {
      // Re-check quota inside the transaction to avoid a race past the limit.
      await this.sendQuota.assertWithinQuota(ownerId, tx);

      const createdRequests = [];
      for (const r of recipients) {
        const accessToken = randomBytes(24).toString('hex');
        const verifyCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const signRequest = await tx.signRequest.create({
          data: {
            documentId,
            recipientEmail: r.email,
            recipientName: r.name,
            order: r.order,
            status: SignRequestStatus.PENDING,
            accessToken,
            verifyCode,
          },
        });
        createdRequests.push({ ...r, signRequestId: signRequest.id, accessToken });

        // Assign this recipient's fields (by index) to their request.
        await tx.signField.updateMany({
          where: { documentId, recipientIndex: r.index, signRequestId: null },
          data: { signRequestId: signRequest.id },
        });
      }

      // Any field not matched to a recipient (e.g. index beyond recipient
      // count) defaults to the first signer so nothing is orphaned.
      const first = createdRequests[0];
      if (first) {
        await tx.signField.updateMany({
          where: { documentId, signRequestId: null },
          data: { signRequestId: first.signRequestId },
        });
      }

      const updated = await tx.document.update({
        where: { id: documentId },
        // Clearing the schedule columns keeps them null for the immediate-send
        // path (already null → no-op) and, crucially, tidies a scheduled send
        // as it dispatches so the row no longer reads as "예약됨".
        data: {
          status: DocumentStatus.IN_PROGRESS,
          sentAt: new Date(),
          scheduledSendAt: null,
          scheduledJobId: null,
        },
      });

      await tx.auditLog.create({
        data: {
          documentId,
          actorId: ownerId,
          action: 'CONTRACT_SENT',
          ipAddress: ip,
          metadata: {
            recipientCount: createdRequests.length,
            recipients: createdRequests.map((c) => ({ email: c.email, order: c.order })),
          },
        },
      });

      return { updated, createdRequests };
    });

    // Fire-and-forget notifications (queue or console fallback).
    const jobs: NotificationJob[] = [];
    for (const r of result.createdRequests) {
      const signUrl = `${webOrigin}/sign/${r.accessToken}`;
      const data = { documentTitle: document.title, signUrl, recipientName: r.name };
      jobs.push({ channel: 'alimtalk', to: r.email, toName: r.name, template: 'sign_request', data });
      jobs.push({ channel: 'email', to: r.email, toName: r.name, template: 'sign_request', data });
    }
    await this.notifications.enqueueMany(jobs);

    return { updated: result.updated, recipientCount: result.createdRequests.length };
  }

  /**
   * Auto-send a scheduled document when its delayed job fires (grain-2 worker
   * callback — `ScheduledSendDispatcher`). Reuses the grain-1 `dispatchContract`
   * core with the recipients captured at schedule time.
   *
   * Idempotency / stale-job guard: a job may still fire for a document that was
   * cancelled, rescheduled, or already sent (a removed job that raced the timer).
   * We only dispatch when the row is still SCHEDULED; otherwise this is a
   * logged no-op, so a stale job can never double-send or resurrect a cancel.
   * Errors propagate so BullMQ retries (and the queue alerts the sender once the
   * retry budget is spent).
   */
  async dispatchScheduled(data: ScheduledSendJobData): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: data.documentId },
    });
    if (!document) {
      this.logger.warn(`예약 발송 건너뜀 — 문서를 찾을 수 없어요: ${data.documentId}`);
      return;
    }
    if (document.status !== DocumentStatus.SCHEDULED) {
      this.logger.log(
        `예약 발송 건너뜀 — 더 이상 예약 상태가 아니에요(status=${document.status}): ${data.documentId}`,
      );
      return;
    }

    await this.dispatchContract(document, data.recipients, data.ownerId, data.ip);
    this.logger.log(`예약 발송 완료: ${data.documentId} (수신자 ${data.recipients.length}명)`);
  }

  /**
   * Handle a scheduled send that failed for good — retries exhausted on the
   * durable BullMQ path, or an inline-fallback dispatch error (grain-2 worker
   * callback). Two things happen, in this order:
   *
   *   1. Recover the document to a re-sendable state. A permanently-failed
   *      reservation must not stay stranded in SCHEDULED (no job left to fire),
   *      or the sender can neither auto-send nor re-send it. We return it to
   *      DRAFT and null the reservation columns (`scheduledSendAt`,
   *      `scheduledJobId`) so the normal `send` path works again, and write an
   *      audit entry for the transition. This is guarded on the *current* status:
   *      only a still-SCHEDULED row is recovered, so a stale job that final-fails
   *      after the sender already cancelled or rescheduled (a removed job racing
   *      the timer) never clobbers the newer state — exactly the guard
   *      `dispatchScheduled` relies on.
   *   2. Alert the sender (email + alimtalk) so the failure surfaces and they
   *      know the contract is back in 작성 중 and can be re-sent.
   *
   * Never throws — a DB or notification hiccup here must not crash the worker's
   * failure handler. The recovery is best-effort and isolated in its own
   * try/catch so a write failure still lets the alert go out. `reason` is kept as
   * diagnostic detail (audit metadata + server logs) only; it is deliberately NOT
   * threaded into the user-facing notification, per the copy tone guide (no
   * system internals surfaced to the sender).
   */
  async notifyScheduledSendFailure(documentId: string, reason: string): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        status: true,
        ownerId: true,
        scheduledJobId: true,
        title: true,
        owner: { select: { email: true, name: true } },
      },
    });
    if (!document) {
      this.logger.warn(
        `예약 발송 실패 알림 건너뜀 — 문서를 찾을 수 없어요: ${documentId} (${reason})`,
      );
      return;
    }

    await this.recoverFailedSchedule(documentId, document, reason);

    const webOrigin = this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
    const notifyData = {
      documentTitle: document.title,
      dashboardUrl: `${webOrigin}/dashboard`,
    };
    const to = document.owner.email;
    const toName = document.owner.name;
    await this.notifications.enqueueMany([
      { channel: 'alimtalk', to, toName, template: 'scheduled_send_failed', data: notifyData },
      { channel: 'email', to, toName, template: 'scheduled_send_failed', data: notifyData },
    ]);
    this.logger.warn(`예약 발송 실패 — 발송자에게 알림: ${documentId} (${reason})`);
  }

  /**
   * Return a permanently-failed scheduled send to a re-sendable DRAFT (status +
   * cleared reservation columns + audit entry), but only while the row is still
   * SCHEDULED. Best-effort: any write error is logged and swallowed so the
   * failure alert still reaches the sender.
   */
  private async recoverFailedSchedule(
    documentId: string,
    document: { status: DocumentStatus; ownerId: string; scheduledJobId: string | null },
    reason: string,
  ): Promise<void> {
    if (document.status !== DocumentStatus.SCHEDULED) {
      this.logger.log(
        `예약 발송 실패 회복 건너뜀 — 더 이상 예약 상태가 아니에요(status=${document.status}): ${documentId}`,
      );
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.document.update({
          where: { id: documentId },
          // Back to DRAFT with the reservation cleared so the normal send path
          // (and a fresh reschedule) works again — the contract is no longer
          // trapped in 예약됨 with no job to fire it.
          data: {
            status: DocumentStatus.DRAFT,
            scheduledSendAt: null,
            scheduledJobId: null,
          },
        });
        await tx.auditLog.create({
          data: {
            documentId,
            actorId: document.ownerId,
            action: 'SCHEDULED_SEND_FAILED',
            metadata: {
              reason,
              previousJobId: document.scheduledJobId,
              recoveredTo: DocumentStatus.DRAFT,
            },
          },
        });
      });
      this.logger.warn(
        `예약 발송 최종 실패 — 문서를 DRAFT로 회복(재발송 가능): ${documentId}`,
      );
    } catch (err) {
      this.logger.error(
        `예약 발송 실패 문서 회복 실패: ${documentId}: ${String(err)}`,
      );
    }
  }

  /** Dashboard list for the signed-in sender, newest first. */
  async list(ownerId: string): Promise<DocumentSummary[]> {
    // Single `now` for the whole page so every row's urgency is derived against
    // the same instant.
    const now = new Date();
    const documents = await this.prisma.document.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      include: {
        // Total recipient count (unchanged) …
        _count: { select: { signRequests: true } },
        // … plus each request's status so we can count the still-pending signers
        // in JS via the pure `countPendingSigners` helper (no schema change).
        signRequests: { select: { status: true } },
      },
    });
    return documents.map((d) =>
      this.toSummary(
        d,
        d._count.signRequests,
        countPendingSigners(d.signRequests.map((s) => s.status)),
        now,
      ),
    );
  }

  async detail(ownerId: string, documentId: string): Promise<DocumentDetail> {
    const now = new Date();
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        signRequests: {
          orderBy: { order: 'asc' },
          select: { id: true, recipientEmail: true, recipientName: true, order: true, status: true },
        },
        signFields: {
          select: {
            id: true,
            type: true,
            page: true,
            x: true,
            y: true,
            width: true,
            height: true,
            recipientIndex: true,
            signRequestId: true,
          },
        },
      },
    });
    if (!document) throw new NotFoundException(MESSAGES.document.notFound);
    if (document.ownerId !== ownerId) throw new ForbiddenException(MESSAGES.document.forbidden);

    return {
      ...this.toSummary(
        document,
        document.signRequests.length,
        countPendingSigners(document.signRequests.map((s) => s.status)),
        now,
      ),
      recipients: document.signRequests,
      fields: document.signFields,
    };
  }

  /**
   * Open a completed contract's artifact (signed final PDF or audit certificate)
   * for the owner to download. Owner-only; only available once the completion
   * post-processing (grain-5) has stored the artifact. Returns a byte stream and
   * the user-facing filename so the controller can stream it as an attachment.
   */
  async openArtifact(
    ownerId: string,
    documentId: string,
    kind: CompletionArtifact,
  ): Promise<{ stream: Readable; filename: string }> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        ownerId: true,
        title: true,
        status: true,
        signedStorageKey: true,
        certificateStorageKey: true,
      },
    });
    if (!document) throw new NotFoundException(MESSAGES.document.notFound);
    if (document.ownerId !== ownerId) throw new ForbiddenException(MESSAGES.document.forbidden);

    const key =
      kind === 'signed' ? document.signedStorageKey : document.certificateStorageKey;
    if (document.status !== DocumentStatus.COMPLETED || !key) {
      throw new NotFoundException(MESSAGES.document.artifactNotReady);
    }

    const stream = await this.storage.openStream(key);
    return { stream, filename: artifactFilename(document.title, kind) };
  }

  /** Remaining Free-plan sends this calendar month. */
  quota(ownerId: string): Promise<{ used: number; limit: number; remaining: number }> {
    return this.sendQuota.quota(ownerId);
  }

  // --- internals ----------------------------------------------------------

  private async requireOwnedDocument(ownerId: string, documentId: string): Promise<Document> {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException(MESSAGES.document.notFound);
    if (document.ownerId !== ownerId) throw new ForbiddenException(MESSAGES.document.forbidden);
    return document;
  }

  private async writeAudit(input: {
    documentId?: string;
    signRequestId?: string;
    actorId?: string;
    action: string;
    ip?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        documentId: input.documentId,
        signRequestId: input.signRequestId,
        actorId: input.actorId,
        action: input.action,
        ipAddress: input.ip,
        metadata: input.metadata,
      },
    });
  }

  private looksLikePdf(file: { mimetype: string; originalname: string; buffer: Buffer }): boolean {
    const byMime = file.mimetype === 'application/pdf';
    const byExt = file.originalname.toLowerCase().endsWith('.pdf');
    const byMagic = file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    return (byMime || byExt) && byMagic;
  }

  private async countPdfPages(buffer: Buffer): Promise<number> {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(buffer, { updateMetadata: false });
      return pdf.getPageCount();
    } catch (err) {
      this.logger.warn(`PDF 페이지 수 계산 실패: ${String(err)}`);
      throw new BadRequestException(MESSAGES.document.corruptPdf);
    }
  }

  /**
   * Repair a file name that Multer may have mis-decoded before it is used.
   *
   * Multipart field values (the file name included) are decoded as latin1, so a
   * UTF-8 name — 한글, 이모지, 그 밖의 비ASCII — surfaces as mojibake: every
   * original UTF-8 byte became one latin1 code point. We re-encode those code
   * points back to bytes and read them as UTF-8, but ONLY when that is provably
   * safe, so already-valid names are never double-encoded:
   *   - pure ASCII names have nothing to fix and are returned untouched;
   *   - names that already hold real Unicode (code point > 0xFF, e.g. a
   *     correctly decoded `계약서.pdf`) were decoded fine — re-encoding would
   *     corrupt them, so they are returned untouched;
   *   - otherwise the latin1 bytes are re-read as UTF-8 and adopted only if they
   *     form a valid UTF-8 sequence that round-trips exactly. That rules out
   *     genuine latin1 names (e.g. a lone accent in `café.pdf`) whose bytes are
   *     not valid UTF-8, and guarantees we never decode twice.
   */
  private normalizeUploadFilename(originalName: string): string {
    if (!originalName) return originalName;

    let hasHighByte = false;
    for (let i = 0; i < originalName.length; i++) {
      const code = originalName.charCodeAt(i);
      // A code point beyond latin1 means the name is already real Unicode.
      if (code > 0xff) return originalName;
      if (code >= 0x80) hasHighByte = true;
    }
    // Pure ASCII: no mojibake is possible, so keep it exactly as-is.
    if (!hasHighByte) return originalName;

    const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
    // Adopt the re-decoded value only when the latin1 bytes were a valid UTF-8
    // sequence: re-encoding must reproduce the exact original bytes. Invalid
    // sequences fail this check and keep the original name unchanged.
    const roundTrips =
      Buffer.from(decoded, 'utf8').toString('latin1') === originalName;
    return roundTrips ? decoded : originalName;
  }

  private deriveTitle(originalName: string): string {
    const base = originalName.replace(/\.pdf$/i, '').trim();
    return base.length > 0 ? base.slice(0, 200) : '제목 없는 계약';
  }

  /**
   * Shape a persisted document into the API summary, filling the derived TO-DO
   * signals (urgency, next action, pending signer count) via the pure grain-1
   * helpers in `document-todo.ts`. `now` and `pendingSignerCount` are injected by
   * the caller so this stays deterministic and works for every call site —
   * `list()`/`detail()` compute the pending count from included sign-request
   * statuses, while the create/send paths pass what they already know.
   */
  private toSummary(
    document: Document,
    recipientCount: number,
    pendingSignerCount: number,
    now: Date,
  ): DocumentSummary {
    return {
      id: document.id,
      title: document.title,
      status: document.status,
      statusLabel: DOCUMENT_STATUS_LABEL[document.status],
      // Owner-scoped: every `toSummary` call site is already gated to the owner
      // (upload/create build the owner's own doc; list filters by ownerId;
      // send/detail assert ownership), so exposing the raw storage key here is
      // safe. The wizard needs it to reference the uploaded PDF when saving a
      // template without re-uploading the bytes.
      storageKey: document.storageKey,
      pageCount: document.pageCount,
      recipientCount,
      sentAt: document.sentAt ? document.sentAt.toISOString() : null,
      // When the contract is queued for a future send its scheduled instant is
      // surfaced (ISO) so the dashboard can show "예약됨 · {일시}"; null whenever
      // there is no pending schedule (any non-SCHEDULED status).
      scheduledSendAt: document.scheduledSendAt
        ? document.scheduledSendAt.toISOString()
        : null,
      createdAt: document.createdAt.toISOString(),
      completedAt: document.completedAt ? document.completedAt.toISOString() : null,
      // The dashboard download area only appears once post-processing has stored
      // both artifacts; until then it shows a "준비 중" placeholder.
      downloadsReady:
        document.status === DocumentStatus.COMPLETED &&
        Boolean(document.signedStorageKey) &&
        Boolean(document.certificateStorageKey),
      // Derived TO-DO signals (no schema change): computed at read time from the
      // document's existing status/sentAt and its sign-request statuses.
      urgency: deriveUrgency(document.status, document.sentAt, now),
      nextAction: deriveNextAction(document.status),
      pendingSignerCount,
    };
  }
}

export interface DocumentSummary {
  id: string;
  title: string;
  status: DocumentStatus;
  statusLabel: string;
  /**
   * Storage key of the uploaded source PDF. Owner-scoped — only returned on
   * owner-gated read paths — so the creation wizard can reference the persisted
   * bytes (e.g. when saving a template) without re-uploading.
   */
  storageKey: string;
  pageCount: number;
  recipientCount: number;
  sentAt: string | null;
  /**
   * ISO instant the contract is queued to auto-send, present only while the
   * document is SCHEDULED; `null` for every other status. Lets the dashboard
   * render the reservation time alongside the 예약됨 status.
   */
  scheduledSendAt: string | null;
  createdAt: string;
  /** ISO completion timestamp once the contract is fully signed (else null). */
  completedAt: string | null;
  /** True when both completion artifacts are stored and downloadable. */
  downloadsReady: boolean;
  /**
   * How much attention this contract needs today, derived at read time from
   * `status` + `sentAt` (grain-1 vocabulary). Always present.
   */
  urgency: Urgency;
  /**
   * The single next action for the owner, derived from `status`. `null` is the
   * defined fallback for CANCELLED (no actionable next step) — this field is
   * nullable.
   */
  nextAction: NextAction | null;
  /** Signers still awaited (PENDING or VIEWED). 0 when none/not sent. */
  pendingSignerCount: number;
}

export interface DocumentDetail extends DocumentSummary {
  recipients: Array<{
    id: string;
    // Null for LINK-mode share links (no addressed recipient).
    recipientEmail: string | null;
    recipientName: string | null;
    order: number;
    status: SignRequestStatus;
  }>;
  fields: Array<{
    id: string;
    type: string;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    recipientIndex: number | null;
    signRequestId: string | null;
  }>;
}
