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
  Plan,
  Prisma,
  SignRequestStatus,
  type Document,
} from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService, type NotificationJob } from '../notifications/notifications.service';
import { FREE_PLAN_MONTHLY_LIMIT, MESSAGES } from '../common/messages';
import { DOCUMENT_STATUS_LABEL } from './document-status';
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
    if (!this.looksLikePdf(file)) {
      throw new BadRequestException(MESSAGES.document.invalidFileType);
    }

    const pageCount = await this.countPdfPages(file.buffer);
    const storageKey = this.storage.buildKey(ownerId, file.originalname);
    await this.storage.save(storageKey, file.buffer);

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

    return this.toSummary(document, 0);
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

    return this.toSummary(document, 0);
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

    await this.assertWithinQuota(ownerId);

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
      await this.assertWithinQuota(ownerId, tx);

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

    return this.toSummary(result.updated, result.createdRequests.length);
  }

  /** Dashboard list for the signed-in sender, newest first. */
  async list(ownerId: string): Promise<DocumentSummary[]> {
    const documents = await this.prisma.document.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { signRequests: true } } },
    });
    return documents.map((d) => this.toSummary(d, d._count.signRequests));
  }

  async detail(ownerId: string, documentId: string): Promise<DocumentDetail> {
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
      ...this.toSummary(document, document.signRequests.length),
      recipients: document.signRequests,
      fields: document.signFields,
    };
  }

  /** Remaining Free-plan sends this calendar month. */
  async quota(ownerId: string): Promise<{ used: number; limit: number; remaining: number }> {
    const used = await this.monthlySendCount(ownerId);
    return { used, limit: FREE_PLAN_MONTHLY_LIMIT, remaining: Math.max(0, FREE_PLAN_MONTHLY_LIMIT - used) };
  }

  // --- internals ----------------------------------------------------------

  private async assertWithinQuota(
    ownerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const user = await client.user.findUnique({ where: { id: ownerId }, select: { plan: true } });
    if (user?.plan && user.plan !== Plan.FREE) return; // Paid plans are unmetered here.

    const used = await this.monthlySendCount(ownerId, tx);
    if (used >= FREE_PLAN_MONTHLY_LIMIT) {
      throw new ForbiddenException(MESSAGES.send.quotaExceeded);
    }
  }

  private async monthlySendCount(ownerId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const client = tx ?? this.prisma;
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return client.document.count({
      where: { ownerId, sentAt: { gte: startOfMonth } },
    });
  }

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

  private deriveTitle(originalName: string): string {
    const base = originalName.replace(/\.pdf$/i, '').trim();
    return base.length > 0 ? base.slice(0, 200) : '제목 없는 계약';
  }

  private toSummary(document: Document, recipientCount: number): DocumentSummary {
    return {
      id: document.id,
      title: document.title,
      status: document.status,
      statusLabel: DOCUMENT_STATUS_LABEL[document.status],
      pageCount: document.pageCount,
      recipientCount,
      sentAt: document.sentAt ? document.sentAt.toISOString() : null,
      createdAt: document.createdAt.toISOString(),
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
}

export interface DocumentDetail extends DocumentSummary {
  recipients: Array<{
    id: string;
    recipientEmail: string;
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
