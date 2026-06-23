import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { DocumentStatus } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  SignedPdfService,
  type SignFieldInput,
} from '../pdf/signed-pdf.service';
import {
  AuditCertificateService,
  type AuditActorRole,
  type AuditCertificateInput,
  type AuditEvent,
  type CertificateParticipant,
} from '../pdf/audit-certificate.service';
import { EmailService, type EmailMessage } from '../email/email.service';
import {
  renderCompletionEmail,
  type CompletionEmailRole,
} from '../email/completion-email.template';
import type { CompletionResult } from './completion.constants';

/** Human-readable identity-verification method used across the signer flow. */
const VERIFICATION_METHOD = '6자리 인증코드';

/** Footer / subject service name (matches the web product name). */
const SERVICE_NAME = '전자계약';

/**
 * Completion post-processing orchestrator (grain-5).
 *
 * Runs once, idempotently, when a document's last signer finishes:
 *   1. load the original PDF and composite captured signatures → final PDF
 *      (grain-2 `SignedPdfService`),
 *   2. render the audit-trail certificate from the document's history
 *      (grain-3 `AuditCertificateService`),
 *   3. store both PDFs (grain storage, S3 / local fallback),
 *   4. email every participant (sender + all signers) with both attachments
 *      (grain-4 `EmailService`),
 *   5. record the artifact keys + completion time on the `Document`.
 *
 * Boundary: this service only *composes* the grain-2/3/4 services — it never
 * re-implements PDF/email internals. `Document.status` is already set to
 * COMPLETED by `signing.service.complete()`; this only fills the artifact keys
 * and the completion timestamp. `completedAt` doubles as the idempotency
 * marker, so a re-run on an already-processed document is a no-op.
 */
@Injectable()
export class CompletionService {
  private readonly logger = new Logger(CompletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly signedPdf: SignedPdfService,
    private readonly certificate: AuditCertificateService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Generate, store, email, and record the completion artifacts for a document.
   * Idempotent: returns `skipped` without side effects if the document is not
   * COMPLETED, has no artifacts pending, or was already post-processed.
   *
   * Throws on transient failures (PDF/storage/DB) so the BullMQ worker retries.
   * Email never throws (grain-4 console fallback), so a missing SES config does
   * not fail the pipeline.
   */
  async runPostProcessing(documentId: string): Promise<CompletionResult> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        owner: { select: { name: true, email: true, brandColor: true, brandLogoUrl: true } },
        signRequests: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          include: {
            signFields: {
              select: { type: true, page: true, x: true, y: true, width: true, height: true, value: true },
            },
          },
        },
        auditLogs: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!document) {
      this.logger.warn(`후처리 건너뜀 — 문서를 찾을 수 없어요: ${documentId}`);
      return { documentId, processed: false, skipped: true };
    }

    // Defensive: only post-process a fully-completed contract.
    if (document.status !== DocumentStatus.COMPLETED) {
      this.logger.warn(
        `후처리 건너뜀 — 문서가 아직 완료 상태가 아니에요(status=${document.status}): ${documentId}`,
      );
      return { documentId, processed: false, skipped: true };
    }

    // Idempotency: `completedAt` set means this document was already processed.
    if (document.completedAt) {
      this.logger.log(`후처리 건너뜀 — 이미 완료 처리된 문서예요: ${documentId}`);
      return { documentId, processed: false, skipped: true };
    }

    this.logger.log(`완료 후처리 시작: ${documentId}`);

    // 1) Original PDF → signed final PDF (composite captured field values).
    const originalPdf = await this.storage.read(document.storageKey);
    const fields = this.collectFields(document.signRequests);
    const signedPdf = await this.signedPdf.compose(originalPdf, fields);

    // 2) Audit-trail certificate from the document's full history.
    const completionEvent = document.auditLogs.find((a) => a.action === 'DOCUMENT_COMPLETED');
    const completedAt = completionEvent?.createdAt ?? new Date();
    const issuedAt = new Date();
    const certificateInput = this.buildCertificateInput(document, signedPdf, originalPdf, completedAt, issuedAt);
    const certificatePdf = await this.certificate.generate(certificateInput);

    // 3) Store both PDFs under new, deterministic keys (retries overwrite,
    //    never leak orphan objects).
    const signedStorageKey = this.artifactKey(document.ownerId, documentId, 'signed');
    const certificateStorageKey = this.artifactKey(document.ownerId, documentId, 'certificate');
    await this.storage.save(signedStorageKey, signedPdf);
    await this.storage.save(certificateStorageKey, certificatePdf);

    // 4) Email sender + every signer with both attachments.
    const recipientCount = await this.sendCompletionEmails(document, signedPdf, certificatePdf);

    // 5) Record artifact keys + completion time. Guard on `completedAt: null`
    //    so a concurrent duplicate run cannot double-write.
    await this.prisma.document.updateMany({
      where: { id: documentId, completedAt: null },
      data: { signedStorageKey, certificateStorageKey, completedAt },
    });

    this.logger.log(
      `완료 후처리 끝: ${documentId} (수신자 ${recipientCount}명, 최종본=${signedStorageKey})`,
    );

    return {
      documentId,
      processed: true,
      skipped: false,
      signedStorageKey,
      certificateStorageKey,
      recipientCount,
    };
  }

  /** Flatten every filled sign field across all signers into composite inputs. */
  private collectFields(
    signRequests: Array<{ signFields: Array<{ type: string; page: number; x: number; y: number; width: number; height: number; value: string | null }> }>,
  ): SignFieldInput[] {
    const inputs: SignFieldInput[] = [];
    for (const sr of signRequests) {
      for (const f of sr.signFields) {
        if (!f.value || f.value.trim().length === 0) continue;
        inputs.push({
          type: f.type as SignFieldInput['type'],
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          value: f.value,
        });
      }
    }
    return inputs;
  }

  /** Assemble the certificate input from queried domain data + PDF hashes. */
  private buildCertificateInput(
    document: DocumentWithRelations,
    signedPdf: Buffer,
    originalPdf: Buffer,
    completedAt: Date,
    issuedAt: Date,
  ): AuditCertificateInput {
    const participants: CertificateParticipant[] = document.signRequests.map((sr, i) => ({
      name: sr.recipientName,
      email: sr.recipientEmail,
      order: i + 1,
      verificationMethod: VERIFICATION_METHOD,
      signedAt: sr.signedAt,
    }));

    const nameBySignRequest = new Map(
      document.signRequests.map((sr) => [sr.id, sr.recipientName]),
    );

    const events: AuditEvent[] = document.auditLogs.map((log) => {
      let actorRole: AuditActorRole;
      let actorName: string | null | undefined;
      if (log.signRequestId) {
        actorRole = 'SIGNER';
        actorName = nameBySignRequest.get(log.signRequestId) ?? null;
      } else if (log.actorId) {
        actorRole = 'SENDER';
        actorName = document.owner.name;
      } else {
        actorRole = 'SYSTEM';
      }
      return {
        action: log.action,
        occurredAt: log.createdAt,
        actorName,
        actorRole,
        ipAddress: log.ipAddress,
      };
    });

    return {
      document: {
        id: document.id,
        title: document.title,
        pageCount: document.pageCount,
        sentAt: document.sentAt,
        completedAt,
      },
      sender: {
        name: document.owner.name,
        email: document.owner.email,
        brandColor: document.owner.brandColor,
      },
      participants,
      events,
      originalPdfSha256: sha256(originalPdf),
      finalPdfSha256: sha256(signedPdf),
      issuedAt,
      certificateId: buildCertificateId(document.id, completedAt),
      serviceName: SERVICE_NAME,
    };
  }

  /** Send the completion email (final PDF + certificate) to all participants. */
  private async sendCompletionEmails(
    document: DocumentWithRelations,
    signedPdf: Buffer,
    certificatePdf: Buffer,
  ): Promise<number> {
    const attachments = [
      { filename: attachmentName(document.title, '최종 계약서'), content: signedPdf },
      { filename: attachmentName(document.title, '감사 추적 인증서'), content: certificatePdf },
    ];
    const senderName = document.owner.name ?? '발신자';
    const dashboardUrl = `${this.webOrigin()}/dashboard`;

    const build = (
      to: { email: string; name?: string | null },
      role: CompletionEmailRole,
    ): EmailMessage => {
      const rendered = renderCompletionEmail({
        contractTitle: document.title,
        senderName,
        recipientRole: role,
        brandColor: document.owner.brandColor,
        brandLogoUrl: document.owner.brandLogoUrl,
        dashboardUrl: role === 'SENDER' ? dashboardUrl : null,
        serviceName: SERVICE_NAME,
      });
      return {
        to: [to],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        attachments,
      };
    };

    // De-duplicate by email so a sender who is also a signer gets one copy
    // (the sender copy wins — it carries the dashboard CTA).
    const messages: EmailMessage[] = [];
    const seen = new Set<string>();
    const senderEmail = document.owner.email.trim().toLowerCase();
    messages.push(build({ email: document.owner.email, name: senderName }, 'SENDER'));
    seen.add(senderEmail);
    for (const sr of document.signRequests) {
      const key = sr.recipientEmail.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      messages.push(build({ email: sr.recipientEmail, name: sr.recipientName }, 'SIGNER'));
    }

    await this.email.sendEach(messages);
    return messages.length;
  }

  private webOrigin(): string {
    return this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
  }

  /** Deterministic artifact key so retries overwrite instead of leaking. */
  private artifactKey(ownerId: string, documentId: string, kind: 'signed' | 'certificate'): string {
    return `documents/${ownerId}/completed/${documentId}-${kind}.pdf`;
  }
}

/** Shape consumed by the certificate/email helpers (subset of the query). */
interface DocumentWithRelations {
  id: string;
  ownerId: string;
  title: string;
  pageCount: number;
  storageKey: string;
  status: DocumentStatus;
  sentAt: Date | null;
  completedAt: Date | null;
  owner: { name: string | null; email: string; brandColor: string | null; brandLogoUrl: string | null };
  signRequests: Array<{
    id: string;
    recipientEmail: string;
    recipientName: string | null;
    signedAt: Date | null;
  }>;
  auditLogs: Array<{
    action: string;
    createdAt: Date;
    signRequestId: string | null;
    actorId: string | null;
    ipAddress: string | null;
  }>;
}

/** Lowercase hex SHA-256 of the given bytes. */
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `CERT-YYYYMMDD-XXXXXXXX` — date (KST) + a stable suffix from the doc id. */
function buildCertificateId(documentId: string, completedAt: Date): string {
  const kst = new Date(completedAt.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}`;
  const suffix = documentId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase() || 'DOCUMENT';
  return `CERT-${date}-${suffix}`;
}

/** Build a readable, filesystem-safe attachment name from the contract title. */
function attachmentName(title: string, kind: string): string {
  const safe = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '계약서';
  return `${safe} (${kind}).pdf`;
}
