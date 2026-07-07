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
import type { CreateDocumentDto, SaveFieldsDto, SendContractDto } from './dto/documents.dto';
import { DocumentConversionService } from './document-conversion.service';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

/** MIME type reported by browsers for a `.docx` (OOXML WordprocessingML) file. */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Accepted multipart upload formats. The canonical stored bytes are always PDF. */
type UploadKind = 'pdf' | 'docx';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly sendQuota: SendQuotaService,
    private readonly conversion: DocumentConversionService,
  ) {}

  /**
   * Multipart upload path: accept a PDF or a DOCX, persist bytes, create a DRAFT.
   *
   * A DOCX is converted to PDF up front (grain-1 service) and, from that point
   * on, the converted PDF is the source of truth: page count, stored bytes, the
   * DRAFT row, and the audit log all describe the PDF, so every downstream step
   * (fields → send → completion) sees the exact same contract as a native PDF
   * upload. The original DOCX is not retained.
   */
  async uploadAndCreate(
    ownerId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
    ip?: string,
  ): Promise<DocumentSummary> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException(MESSAGES.document.emptyFile);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(MESSAGES.document.fileTooLarge);
    }
    const kind = this.detectUploadKind(file);
    if (!kind) {
      throw new BadRequestException(MESSAGES.document.invalidFileType);
    }

    // Normalize to PDF bytes + a `.pdf` filename before the shared PDF pipeline.
    // A corrupt/unsupported DOCX throws grain-1's `document.conversionFailed`.
    const pdfBuffer =
      kind === 'docx' ? await this.conversion.docxToPdf(file.buffer) : file.buffer;
    const storageName =
      kind === 'docx' ? toPdfFilename(file.originalname) : file.originalname;

    const pageCount = await this.countPdfPages(pdfBuffer);
    const storageKey = this.storage.buildKey(ownerId, storageName);
    await this.storage.save(storageKey, pdfBuffer);

    const title = this.deriveTitle(file.originalname);
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

  /**
   * Open the document's stored canonical PDF bytes for its owner — the native
   * PDF upload or the DOCX→PDF conversion result that became the source of truth
   * (`uploadAndCreate`). The frontend renders this for the DRAFT preview and
   * field placement.
   *
   * Owner-only, and deliberately separate from `openArtifact`: that path serves
   * the COMPLETED signed/certificate artifacts, whereas this returns the draft
   * canonical (`storageKey`) that exists from upload onward. Returns a byte
   * stream the controller pipes as `application/pdf`.
   */
  async openDocumentFile(ownerId: string, documentId: string): Promise<Readable> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { ownerId: true, storageKey: true },
    });
    if (!document) throw new NotFoundException(MESSAGES.document.notFound);
    if (document.ownerId !== ownerId) throw new ForbiddenException(MESSAGES.document.forbidden);

    return this.storage.openStream(document.storageKey);
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

  /**
   * Classify a multipart upload as a PDF or a DOCX, or `null` if it is neither.
   * Both checks pair a declared type (MIME or extension) with a content magic
   * signature so a mislabeled or truncated file can't slip through.
   */
  private detectUploadKind(file: {
    mimetype: string;
    originalname: string;
    buffer: Buffer;
  }): UploadKind | null {
    if (this.looksLikePdf(file)) return 'pdf';
    if (this.looksLikeDocx(file)) return 'docx';
    return null;
  }

  private looksLikePdf(file: { mimetype: string; originalname: string; buffer: Buffer }): boolean {
    const byMime = file.mimetype === 'application/pdf';
    const byExt = file.originalname.toLowerCase().endsWith('.pdf');
    const byMagic = file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    return (byMime || byExt) && byMagic;
  }

  private looksLikeDocx(file: { mimetype: string; originalname: string; buffer: Buffer }): boolean {
    const byMime = file.mimetype === DOCX_MIME;
    const byExt = file.originalname.toLowerCase().endsWith('.docx');
    // A .docx is a ZIP container, so its bytes begin with the `PK` local-file
    // signature. (Grain-1's converter does the real structural validation.)
    const byMagic = file.buffer.subarray(0, 2).toString('latin1') === 'PK';
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

  private deriveTitle(originalName: string): string {
    // Strip the uploaded extension (PDF or the pre-conversion DOCX) for the title.
    const base = originalName.replace(/\.(pdf|docx)$/i, '').trim();
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

/**
 * Derive the `.pdf` storage filename for a converted DOCX upload so the stored
 * key matches its actual (PDF) contents. Drops a trailing `.docx` if present,
 * otherwise just appends `.pdf`.
 */
function toPdfFilename(originalName: string): string {
  return `${originalName.replace(/\.docx$/i, '')}.pdf`;
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
