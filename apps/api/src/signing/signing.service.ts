import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Readable } from 'stream';
import {
  DocumentStatus,
  Prisma,
  SignFieldType,
  SignRequestStatus,
} from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  MESSAGES,
  SIGNER_VERIFY_LOCK_WINDOW_MINUTES,
  SIGNER_VERIFY_MAX_ATTEMPTS,
} from '../common/messages';
import { SignerSessionService } from './signer-session.service';
import { CompletionQueue } from '../completion/completion.queue';
import { artifactFilename, type CompletionArtifact } from '../completion/artifact';
import type { SaveFieldValuesDto } from './dto/signing.dto';

/** Audit-log action names for the signer flow. */
const AUDIT_ACTION = {
  VIEWED: 'SIGN_REQUEST_VIEWED',
  VERIFIED: 'SIGN_REQUEST_VERIFIED',
  VERIFY_FAILED: 'SIGN_VERIFY_FAILED',
  SIGNED: 'SIGN_REQUEST_SIGNED',
  DOCUMENT_COMPLETED: 'DOCUMENT_COMPLETED',
} as const;

@Injectable()
export class SigningService {
  private readonly logger = new Logger(SigningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly sessions: SignerSessionService,
    private readonly completionQueue: CompletionQueue,
  ) {}

  // --- ① pre-auth meta -----------------------------------------------------

  /**
   * Minimal, pre-verification metadata for the signing landing screen. Never
   * exposes the PDF, fields, or full recipient identity before the 6-digit
   * code is verified.
   */
  async meta(accessToken: string): Promise<SigningMeta> {
    const signRequest = await this.prisma.signRequest.findUnique({
      where: { accessToken },
      include: {
        document: {
          include: {
            owner: {
              select: {
                name: true,
                brandColor: true,
                brandFont: true,
                brandLogoUrl: true,
              },
            },
          },
        },
      },
    });
    if (!signRequest) throw new NotFoundException(MESSAGES.signing.invalidLink);

    const { document } = signRequest;
    return {
      documentTitle: document.title,
      pageCount: document.pageCount,
      documentStatus: document.status,
      sender: {
        name: document.owner.name,
        brandColor: document.owner.brandColor,
        brandFont: document.owner.brandFont,
        brandLogoUrl: document.owner.brandLogoUrl,
      },
      recipientNameMasked: maskName(signRequest.recipientName),
      status: signRequest.status,
      alreadySigned: signRequest.status === SignRequestStatus.SIGNED,
      signable: this.isSignable(document.status, signRequest.status),
    };
  }

  // --- ② verify code → session --------------------------------------------

  /**
   * Constant-time compare of the 6-digit code. On success: flip PENDING→VIEWED,
   * record a VERIFIED audit log (IP/UA), and issue a short-lived signer session
   * token. On repeated failure within the lock window, deny with a Toss-tone
   * lock message (auto-eases as the window slides).
   */
  async verify(
    accessToken: string,
    code: string,
    ip?: string,
    userAgent?: string,
  ): Promise<VerifyResult> {
    const signRequest = await this.prisma.signRequest.findUnique({
      where: { accessToken },
      select: { id: true, status: true, verifyCode: true, document: { select: { status: true } } },
    });
    if (!signRequest) throw new NotFoundException(MESSAGES.signing.invalidLink);

    if (signRequest.status === SignRequestStatus.SIGNED) {
      throw new ForbiddenException(MESSAGES.signing.alreadySigned);
    }
    if (!this.isSignable(signRequest.document.status, signRequest.status)) {
      throw new ForbiddenException(MESSAGES.signing.notSignable);
    }

    // Lockout: too many recent failures → deny before comparing.
    const recentFailures = await this.countRecentVerifyFailures(signRequest.id);
    if (recentFailures >= SIGNER_VERIFY_MAX_ATTEMPTS) {
      throw new ForbiddenException(MESSAGES.signing.locked);
    }

    const matches =
      !!signRequest.verifyCode && safeEqual(code, signRequest.verifyCode);
    if (!matches) {
      await this.writeAudit({
        signRequestId: signRequest.id,
        action: AUDIT_ACTION.VERIFY_FAILED,
        ip,
        metadata: { userAgent: userAgent ?? null },
      });
      throw new BadRequestException(MESSAGES.signing.codeMismatch);
    }

    // Success: mark viewed (first time) and record the VERIFIED event.
    if (signRequest.status === SignRequestStatus.PENDING) {
      await this.prisma.signRequest.update({
        where: { id: signRequest.id },
        data: { status: SignRequestStatus.VIEWED },
      });
    }
    await this.writeAudit({
      signRequestId: signRequest.id,
      action: AUDIT_ACTION.VERIFIED,
      ip,
      metadata: { userAgent: userAgent ?? null },
    });

    const sessionToken = this.sessions.issue(signRequest.id);
    return { sessionToken, status: SignRequestStatus.VIEWED };
  }

  // --- ③ payload (session) -------------------------------------------------

  /**
   * The signer's working set: their assigned fields (normalized geometry) plus
   * the short-lived API path to stream the PDF. Records a VIEWED audit log the
   * first time the document content is actually served.
   */
  async payload(signRequestId: string): Promise<SigningPayload> {
    const signRequest = await this.prisma.signRequest.findUnique({
      where: { id: signRequestId },
      include: {
        document: { select: { id: true, title: true, pageCount: true, status: true } },
        signFields: {
          orderBy: [{ page: 'asc' }, { y: 'asc' }],
          select: {
            id: true,
            type: true,
            page: true,
            x: true,
            y: true,
            width: true,
            height: true,
            value: true,
          },
        },
      },
    });
    if (!signRequest) throw new NotFoundException(MESSAGES.signing.invalidLink);
    if (signRequest.status === SignRequestStatus.SIGNED) {
      throw new ForbiddenException(MESSAGES.signing.alreadySigned);
    }
    if (!this.isSignable(signRequest.document.status, signRequest.status)) {
      throw new ForbiddenException(MESSAGES.signing.notSignable);
    }

    await this.recordFirstView(signRequestId);

    return {
      documentTitle: signRequest.document.title,
      pageCount: signRequest.document.pageCount,
      pdfPath: `/api/signing/${signRequest.accessToken}/pdf`,
      fields: signRequest.signFields.map((f) => ({
        id: f.id,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        filled: f.value != null && f.value.length > 0,
      })),
    };
  }

  // --- ④ pdf bytes (session) ----------------------------------------------

  /** Open the document's PDF bytes as a stream for `application/pdf` download. */
  async openPdf(signRequestId: string): Promise<Readable> {
    const signRequest = await this.prisma.signRequest.findUnique({
      where: { id: signRequestId },
      select: { document: { select: { storageKey: true } } },
    });
    if (!signRequest) throw new NotFoundException(MESSAGES.signing.invalidLink);

    return this.storage.openStream(signRequest.document.storageKey);
  }

  // --- completion artifact download (session) ------------------------------

  /**
   * Open a completed contract's artifact (signed final PDF or audit certificate)
   * for a signer to download. Available only once the document is COMPLETED and
   * the post-processing (grain-5) has stored the artifact; otherwise a friendly
   * "준비되지 않았어요" error. The session guard already binds this signRequest to
   * the link being accessed, so a signer can only reach their own contract.
   */
  async openArtifact(
    signRequestId: string,
    kind: CompletionArtifact,
  ): Promise<{ stream: Readable; filename: string }> {
    const signRequest = await this.prisma.signRequest.findUnique({
      where: { id: signRequestId },
      select: {
        document: {
          select: {
            title: true,
            status: true,
            signedStorageKey: true,
            certificateStorageKey: true,
          },
        },
      },
    });
    if (!signRequest) throw new NotFoundException(MESSAGES.signing.invalidLink);

    const { document } = signRequest;
    const key =
      kind === 'signed' ? document.signedStorageKey : document.certificateStorageKey;
    if (document.status !== DocumentStatus.COMPLETED || !key) {
      throw new NotFoundException(MESSAGES.document.artifactNotReady);
    }

    const stream = await this.storage.openStream(key);
    return { stream, filename: artifactFilename(document.title, kind) };
  }

  // --- ⑤ save captured field values (session) ------------------------------

  /**
   * Validate and persist captured field values. Each value is checked against
   * its field type (signature dataURL / ISO date / non-empty text). Only fields
   * assigned to this signer can be written.
   */
  async saveFields(
    signRequestId: string,
    dto: SaveFieldValuesDto,
  ): Promise<{ saved: number }> {
    const signRequest = await this.prisma.signRequest.findUnique({
      where: { id: signRequestId },
      select: { id: true, status: true, document: { select: { status: true } } },
    });
    if (!signRequest) throw new NotFoundException(MESSAGES.signing.invalidLink);
    if (signRequest.status === SignRequestStatus.SIGNED) {
      throw new ForbiddenException(MESSAGES.signing.alreadySigned);
    }
    if (!this.isSignable(signRequest.document.status, signRequest.status)) {
      throw new ForbiddenException(MESSAGES.signing.notSignable);
    }

    // Load this signer's fields so we can both authorize and type-check.
    const ownFields = await this.prisma.signField.findMany({
      where: { signRequestId },
      select: { id: true, type: true },
    });
    const fieldById = new Map(ownFields.map((f) => [f.id, f]));

    for (const input of dto.fields) {
      const field = fieldById.get(input.fieldId);
      if (!field) {
        // Field id not assigned to this signer (or unknown).
        throw new BadRequestException(MESSAGES.signing.invalidFieldValue);
      }
      if (!isValidFieldValue(field.type, input.value)) {
        throw new BadRequestException(MESSAGES.signing.invalidFieldValue);
      }
    }

    await this.prisma.$transaction(
      dto.fields.map((input) =>
        this.prisma.signField.update({
          where: { id: input.fieldId },
          data: { value: normalizeFieldValue(fieldById.get(input.fieldId)!.type, input.value) },
        }),
      ),
    );

    return { saved: dto.fields.length };
  }

  // --- ⑥ complete (session) ------------------------------------------------

  /**
   * Finalize the signer's part: require every assigned field filled, flip the
   * SignRequest to SIGNED (+signedAt, SIGNED audit). When this was the last
   * outstanding signer, flip the Document to COMPLETED.
   */
  async complete(
    signRequestId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<CompleteResult> {
    const signRequest = await this.prisma.signRequest.findUnique({
      where: { id: signRequestId },
      select: {
        id: true,
        status: true,
        documentId: true,
        document: { select: { status: true } },
        signFields: { select: { id: true, value: true } },
      },
    });
    if (!signRequest) throw new NotFoundException(MESSAGES.signing.invalidLink);
    if (signRequest.status === SignRequestStatus.SIGNED) {
      throw new ForbiddenException(MESSAGES.signing.alreadySigned);
    }
    if (!this.isSignable(signRequest.document.status, signRequest.status)) {
      throw new ForbiddenException(MESSAGES.signing.notSignable);
    }

    const allFilled = signRequest.signFields.every(
      (f) => f.value != null && f.value.length > 0,
    );
    if (signRequest.signFields.length === 0 || !allFilled) {
      throw new BadRequestException(MESSAGES.signing.fieldsIncomplete);
    }

    const documentCompleted = await this.prisma.$transaction(async (tx) => {
      await tx.signRequest.update({
        where: { id: signRequest.id },
        data: { status: SignRequestStatus.SIGNED, signedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          documentId: signRequest.documentId,
          signRequestId: signRequest.id,
          action: AUDIT_ACTION.SIGNED,
          ipAddress: ip,
          metadata: { userAgent: userAgent ?? null },
        },
      });

      // Last signer? Every SignRequest of the document is now SIGNED.
      const remaining = await tx.signRequest.count({
        where: { documentId: signRequest.documentId, status: { not: SignRequestStatus.SIGNED } },
      });
      if (remaining === 0) {
        await tx.document.update({
          where: { id: signRequest.documentId },
          data: { status: DocumentStatus.COMPLETED },
        });
        await tx.auditLog.create({
          data: {
            documentId: signRequest.documentId,
            action: AUDIT_ACTION.DOCUMENT_COMPLETED,
            ipAddress: ip,
          },
        });
        return true;
      }
      return false;
    });

    // Last signer just finished: kick off completion post-processing (final PDF
    // + certificate + email + artifact recording) AFTER the transaction commits.
    // `enqueue` never throws — a queue hiccup must not break this response.
    if (documentCompleted) {
      await this.completionQueue.enqueue(signRequest.documentId);
    }

    return {
      status: SignRequestStatus.SIGNED,
      documentCompleted,
      message: MESSAGES.signing.completed,
    };
  }

  // --- internals -----------------------------------------------------------

  /** A request can still be signed only while the document is in progress. */
  private isSignable(documentStatus: DocumentStatus, requestStatus: SignRequestStatus): boolean {
    if (requestStatus === SignRequestStatus.SIGNED || requestStatus === SignRequestStatus.DECLINED) {
      return false;
    }
    return (
      documentStatus === DocumentStatus.IN_PROGRESS ||
      documentStatus === DocumentStatus.DRAFT
    );
  }

  private async countRecentVerifyFailures(signRequestId: string): Promise<number> {
    const since = new Date(Date.now() - SIGNER_VERIFY_LOCK_WINDOW_MINUTES * 60_000);
    return this.prisma.auditLog.count({
      where: {
        signRequestId,
        action: AUDIT_ACTION.VERIFY_FAILED,
        createdAt: { gte: since },
      },
    });
  }

  /** Record the VIEWED audit only once (first time the doc is served). */
  private async recordFirstView(signRequestId: string): Promise<void> {
    const existing = await this.prisma.auditLog.count({
      where: { signRequestId, action: AUDIT_ACTION.VIEWED },
    });
    if (existing > 0) return;
    await this.writeAudit({ signRequestId, action: AUDIT_ACTION.VIEWED });
  }

  private async writeAudit(input: {
    signRequestId: string;
    action: string;
    ip?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        signRequestId: input.signRequestId,
        action: input.action,
        ipAddress: input.ip,
        metadata: input.metadata,
      },
    });
  }
}

// --- pure helpers ----------------------------------------------------------

/** Constant-time string compare; false on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Mask a recipient's name for the pre-auth screen: keep the first and last
 * character, replace the middle with `*` (single-char names → `*`).
 */
function maskName(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length <= 1) return '*';
  if (trimmed.length === 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}${'*'.repeat(trimmed.length - 2)}${trimmed[trimmed.length - 1]}`;
}

const SIGNATURE_DATA_URL = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Type-aware server-side validation of a captured field value. */
function isValidFieldValue(type: SignFieldType, value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return false;
  switch (type) {
    case SignFieldType.SIGNATURE:
      return SIGNATURE_DATA_URL.test(v);
    case SignFieldType.DATE:
      return ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
    case SignFieldType.TEXT:
      return v.length <= 500;
    default:
      return false;
  }
}

/** Trim text/date values; preserve signature dataURLs verbatim. */
function normalizeFieldValue(type: SignFieldType, value: string): string {
  return type === SignFieldType.SIGNATURE ? value : value.trim();
}

// --- response shapes -------------------------------------------------------

export interface SigningMeta {
  documentTitle: string;
  pageCount: number;
  documentStatus: DocumentStatus;
  sender: {
    name: string | null;
    brandColor: string | null;
    /** Brand font catalog key (see branding.constants `BRAND_FONTS`), or null. */
    brandFont: string | null;
    brandLogoUrl: string | null;
  };
  recipientNameMasked: string | null;
  status: SignRequestStatus;
  alreadySigned: boolean;
  signable: boolean;
}

export interface VerifyResult {
  sessionToken: string;
  status: SignRequestStatus;
}

export interface SigningPayloadField {
  id: string;
  type: SignFieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  filled: boolean;
}

export interface SigningPayload {
  documentTitle: string;
  pageCount: number;
  pdfPath: string;
  fields: SigningPayloadField[];
}

export interface CompleteResult {
  status: SignRequestStatus;
  documentCompleted: boolean;
  message: string;
}
