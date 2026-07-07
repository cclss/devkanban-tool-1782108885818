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
import { ClauseSummaryQueue } from '../clause-summary/clause-summary.queue';
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

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly sendQuota: SendQuotaService,
    private readonly clauseSummary: ClauseSummaryQueue,
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

    await this.sendQuota.assertWithinQuota(ownerId);

    // Normalize recipient order: explicit `order` wins, else input order.
    const recipients = dto.recipients.map((r, i) => ({
      email: r.email.toLowerCase().trim(),
      name: r.name?.trim() || null,
      order: r.order ?? i,
      index: i,
    }));

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
        data: { status: DocumentStatus.IN_PROGRESS, sentAt: new Date() },
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

    // Kick off background PDF-text-extraction + AI clause-summary generation for
    // the AI 핵심 조항 카드 feature, AFTER the send transaction commits. Like the
    // notifications above this is fire-and-forget: `enqueue` is contractually
    // no-throw (a queue hiccup falls back to inline generation, whose own failures
    // are swallowed and logged), and the extra `.catch` makes doubly sure a
    // failed/absent summary can never roll back the send or turn it into an error
    // response — the reader just falls back to the plain viewer.
    await this.clauseSummary.enqueue(documentId).catch((err) => {
      this.logger.error(
        `클로즈 요약 트리거 실패(발송에는 영향 없음): docId=${documentId}: ${String(err)}`,
      );
    });

    // Just sent: every recipient's request was created PENDING, so all of them
    // are still-pending signers.
    return this.toSummary(
      result.updated,
      result.createdRequests.length,
      result.createdRequests.length,
      new Date(),
    );
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
      pageCount: document.pageCount,
      recipientCount,
      sentAt: document.sentAt ? document.sentAt.toISOString() : null,
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
  pageCount: number;
  recipientCount: number;
  sentAt: string | null;
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
