import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomInt, randomUUID } from 'crypto';
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
import { EmailService, type EmailMessage } from '../email/email.service';
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
import type { CreateDocumentDto, SaveFieldsDto, SendContractDto } from './dto/documents.dto';
import type { UpdateScheduleDto } from './dto/documents.dto';
import {
  ScheduledSendQueue,
  type ScheduledSendJobData,
  type ScheduledSendRecipient,
} from './scheduled-send.queue';

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[char]!);
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly sendQuota: SendQuotaService,
    private readonly scheduledSendQueue: ScheduledSendQueue,
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

    const recipients = this.normalizeRecipients(dto);
    if (dto.scheduledSendAt) {
      return this.schedule(ownerId, document, recipients, dto.scheduledSendAt, ip);
    }
    return this.dispatch(ownerId, document, recipients, ip);
  }

  /** Replace a scheduled document's delayed job with one at a new future time. */
  async updateSchedule(
    ownerId: string,
    documentId: string,
    dto: UpdateScheduleDto,
    ip?: string,
  ): Promise<DocumentSummary> {
    const document = await this.requireOwnedDocument(ownerId, documentId);
    if (document.status !== DocumentStatus.SCHEDULED || !document.scheduledJobId) {
      throw new BadRequestException('예약된 계약만 예약 시간을 변경할 수 있어요.');
    }
    const scheduledFor = this.parseFutureSchedule(dto.scheduledSendAt);
    const nextJobId = this.newScheduledJobId(documentId);
    await this.scheduledSendQueue.replace(document.scheduledJobId, nextJobId, scheduledFor);

    let updated: Document;
    try {
      updated = await this.prisma.document.update({
        where: { id: documentId },
        data: { scheduledSendAt: scheduledFor, scheduledJobId: nextJobId },
      });
    } catch (err) {
      // The old persisted job remains authoritative, so remove only the new
      // delayed job when the database write cannot be completed.
      await this.scheduledSendQueue.remove(nextJobId).catch(() => undefined);
      throw err;
    }
    await this.scheduledSendQueue.remove(document.scheduledJobId).catch((err) => {
      this.logger.warn(`기존 예약 발송 잡 제거 실패: docId=${documentId}: ${String(err)}`);
    });
    await this.writeAudit({
      documentId,
      actorId: ownerId,
      action: 'CONTRACT_SCHEDULE_UPDATED',
      ip,
      metadata: { scheduledSendAt: scheduledFor.toISOString() },
    });
    return this.toSummary(updated, 0, 0, new Date());
  }

  /** Remove a delayed dispatch and make the document editable as a draft again. */
  async cancelSchedule(
    ownerId: string,
    documentId: string,
    ip?: string,
  ): Promise<DocumentSummary> {
    const document = await this.requireOwnedDocument(ownerId, documentId);
    if (document.status !== DocumentStatus.SCHEDULED || !document.scheduledJobId) {
      throw new BadRequestException('예약된 계약만 예약을 취소할 수 있어요.');
    }
    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.DRAFT,
        scheduledSendAt: null,
        scheduledJobId: null,
      },
    });
    // Clearing the persisted job ID first makes a concurrently promoted job a
    // no-op. If Redis is temporarily unavailable, it can never dispatch this
    // cancelled document and will be removed when the queue becomes available.
    await this.scheduledSendQueue.remove(document.scheduledJobId).catch((err) => {
      this.logger.warn(`취소된 예약 발송 잡 제거 실패: docId=${documentId}: ${String(err)}`);
    });
    await this.writeAudit({ documentId, actorId: ownerId, action: 'CONTRACT_SCHEDULE_CANCELLED', ip });
    return this.toSummary(updated, 0, 0, new Date());
  }

  /** Called only by the BullMQ worker when a delayed dispatch becomes due. */
  async dispatchScheduled(data: ScheduledSendJobData): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: data.documentId },
      include: { owner: { select: { email: true, name: true } } },
    });
    // A replacement/cancellation can race an already-promoted delayed job.
    // The persisted ID is the authority, so an obsolete job is a no-op.
    if (
      !document ||
      document.ownerId !== data.ownerId ||
      document.status !== DocumentStatus.SCHEDULED ||
      document.scheduledJobId !== data.jobId
    ) {
      return;
    }
    await this.dispatch(
      data.ownerId,
      document,
      data.recipients,
      undefined,
      DocumentStatus.SCHEDULED,
    );
    await this.notifyScheduledOwner(document, 'scheduled_send_succeeded');
  }

  /**
   * The worker calls this only once BullMQ has exhausted every retry. Keep the
   * document SCHEDULED: the sender can change its time to create a new job or
   * cancel it, and a stale replaced job never produces an alert.
   */
  async notifyScheduledDispatchFailed(data: ScheduledSendJobData): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: data.documentId },
      include: { owner: { select: { email: true, name: true } } },
    });
    if (
      !document ||
      document.ownerId !== data.ownerId ||
      document.status !== DocumentStatus.SCHEDULED ||
      document.scheduledJobId !== data.jobId
    ) {
      return;
    }
    await this.sendScheduledDispatchFailureEmail(document);
  }

  private async schedule(
    ownerId: string,
    document: Document,
    recipients: ScheduledSendRecipient[],
    scheduledSendAt: string,
    ip?: string,
  ): Promise<DocumentSummary> {
    await this.assertDispatchable(ownerId, document.id);
    const scheduledFor = this.parseFutureSchedule(scheduledSendAt);
    const jobId = this.newScheduledJobId(document.id);
    const job: ScheduledSendJobData = { documentId: document.id, ownerId, jobId, recipients };
    await this.scheduledSendQueue.add(job, scheduledFor);

    try {
      const updated = await this.prisma.document.update({
        where: { id: document.id },
        data: {
          status: DocumentStatus.SCHEDULED,
          scheduledSendAt: scheduledFor,
          scheduledJobId: jobId,
        },
      });
      await this.writeAudit({
        documentId: document.id,
        actorId: ownerId,
        action: 'CONTRACT_SCHEDULED',
        ip,
        metadata: { scheduledSendAt: scheduledFor.toISOString(), recipientCount: recipients.length },
      });
      return this.toSummary(updated, 0, 0, new Date());
    } catch (err) {
      await this.scheduledSendQueue.remove(jobId).catch(() => undefined);
      throw err;
    }
  }

  private async dispatch(
    ownerId: string,
    document: Document,
    recipients: ScheduledSendRecipient[],
    ip?: string,
    expectedStatus: DocumentStatus = DocumentStatus.DRAFT,
  ): Promise<DocumentSummary> {
    await this.assertDispatchable(ownerId, document.id);

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
            documentId: document.id,
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
          where: { documentId: document.id, recipientIndex: r.index, signRequestId: null },
          data: { signRequestId: signRequest.id },
        });
      }

      // Any field not matched to a recipient (e.g. index beyond recipient
      // count) defaults to the first signer so nothing is orphaned.
      const first = createdRequests[0];
      if (first) {
        await tx.signField.updateMany({
          where: { documentId: document.id, signRequestId: null },
          data: { signRequestId: first.signRequestId },
        });
      }

      // BullMQ can redeliver a stalled job. Claim the state transition inside
      // the same transaction as SignRequest creation so only one execution can
      // create recipients and dispatch notifications. A losing execution
      // throws, rolling its whole transaction back for a later retry/no-op.
      const claimed = await tx.document.updateMany({
        where: { id: document.id, status: expectedStatus },
        data: {
          status: DocumentStatus.IN_PROGRESS,
          sentAt: new Date(),
          scheduledSendAt: null,
          scheduledJobId: null,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(MESSAGES.send.alreadySent);
      }
      const updated = await tx.document.findUniqueOrThrow({ where: { id: document.id } });

      await tx.auditLog.create({
        data: {
          documentId: document.id,
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

    // Just sent: every recipient's request was created PENDING, so all of them
    // are still-pending signers.
    return this.toSummary(
      result.updated,
      result.createdRequests.length,
      result.createdRequests.length,
      new Date(),
    );
  }

  private async notifyScheduledOwner(
    document: Document & { owner: { email: string; name: string | null } },
    template: 'scheduled_send_succeeded',
  ): Promise<void> {
    const webOrigin = this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
    const data = {
      documentId: document.id,
      documentTitle: document.title,
      scheduledSendAt: document.scheduledSendAt?.toISOString() ?? null,
      documentUrl: `${webOrigin}/documents/${document.id}`,
    };
    await this.notifications.enqueueMany([
      { channel: 'alimtalk', to: document.owner.email, toName: document.owner.name, template, data },
      { channel: 'email', to: document.owner.email, toName: document.owner.name, template, data },
    ]);
  }

  /**
   * The scheduled-send worker reaches this path only after BullMQ has used all
   * of its recipient-dispatch attempts. Send through the real email service
   * instead of the generic notification queue, whose own delivery worker may
   * be unavailable at the same time as the failed scheduled dispatch.
   */
  private async sendScheduledDispatchFailureEmail(
    document: Document & { owner: { email: string; name: string | null } },
  ): Promise<void> {
    const documentUrl = `${this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000'}` +
      `/documents/${document.id}`;
    const title = escapeHtml(document.title);
    const message: EmailMessage = {
      to: [{ email: document.owner.email, name: document.owner.name }],
      subject: `[전자계약] 예약 발송에 실패했어요 — ${document.title}`,
      html: [
        '<p>예약하신 계약서 발송을 완료하지 못했어요.</p>',
        `<p><strong>${title}</strong></p>`,
        '<p>수신자에게는 아직 발송되지 않았습니다. 계약서를 확인한 뒤 발송 시각을 다시 예약하거나 지금 발송해 주세요.</p>',
        `<p><a href="${escapeHtml(documentUrl)}">계약서 확인 및 재발송</a></p>`,
      ].join(''),
      text: [
        '예약하신 계약서 발송을 완료하지 못했어요.',
        document.title,
        '수신자에게는 아직 발송되지 않았습니다. 계약서를 확인한 뒤 발송 시각을 다시 예약하거나 지금 발송해 주세요.',
        `계약서 확인 및 재발송: ${documentUrl}`,
      ].join('\n\n'),
    };
    await this.email.send(message);
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

  private normalizeRecipients(dto: SendContractDto): ScheduledSendRecipient[] {
    return dto.recipients.map((r, index) => ({
      email: r.email.toLowerCase().trim(),
      name: r.name?.trim() || null,
      order: r.order ?? index,
      index,
    }));
  }

  private parseFutureSchedule(value: string): Date {
    const scheduledFor = new Date(value);
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) {
      throw new BadRequestException('예약 발송 시각은 현재보다 미래여야 해요.');
    }
    return scheduledFor;
  }

  private newScheduledJobId(documentId: string): string {
    // BullMQ custom IDs cannot contain `:`, so use only document CUID + UUID.
    return `${documentId}-${randomUUID()}`;
  }

  private async assertDispatchable(ownerId: string, documentId: string): Promise<void> {
    const fieldCount = await this.prisma.signField.count({ where: { documentId } });
    if (fieldCount === 0) {
      throw new BadRequestException(MESSAGES.send.noFields);
    }
    await this.sendQuota.assertWithinQuota(ownerId);
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
  /** ISO-8601 target dispatch time while this document is SCHEDULED. */
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
