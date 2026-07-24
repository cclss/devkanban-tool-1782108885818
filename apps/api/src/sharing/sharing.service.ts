import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import {
  DocumentStatus,
  Prisma,
  SignRequestAccessMode,
  SignRequestStatus,
} from '@repo/db';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import {
  MESSAGES,
  SHARE_LINK_DEFAULT_EXPIRY_DAYS,
  SHARE_UNLOCK_LOCK_WINDOW_MINUTES,
  SHARE_UNLOCK_MAX_ATTEMPTS,
} from '../common/messages';
import { SigningService } from '../signing/signing.service';
import {
  assertLinkAccessible,
  deriveLinkState,
  type ShareLinkState,
} from './link-state';
import { ShareSessionService } from './share-session.service';
import { LinkPasswordCipher } from './link-password-cipher';
import { SendQuotaService } from '../common/send-quota.service';
import type { SaveFieldValuesDto } from '../signing/dto/signing.dto';
import type { CreateShareLinkDto, UpdateShareLinkPasswordDto } from './dto/sharing.dto';

/** Audit-log action names for the share-link flow. */
const AUDIT_ACTION = {
  CREATED: 'SHARE_LINK_CREATED',
  REVOKED: 'SHARE_LINK_REVOKED',
  VIEWED: 'SHARE_LINK_VIEWED',
  UNLOCKED: 'SHARE_LINK_UNLOCKED',
  UNLOCK_FAILED: 'SHARE_UNLOCK_FAILED',
  PASSWORD_VIEWED: 'SHARE_LINK_PASSWORD_VIEWED',
  PASSWORD_UPDATED: 'SHARE_LINK_PASSWORD_UPDATED',
} as const;

/**
 * Link-sharing flow: the sender mints a self-serve "open/fill" link for a
 * document, and an anonymous recipient opens it, fills the designated fields,
 * and submits. A share link is modelled as a LINK-mode `SignRequest` so the
 * recipient reuses the exact same field/submit/completion machinery as the OTP
 * signer flow (`SigningService`) — only the access gate differs (optional
 * password + expiry + revocation instead of an out-of-band code).
 *
 * Security invariants:
 *   • The link password is stored as reversible ciphertext (AES-256-GCM under an
 *     app secret) so the sender can review/edit it; the plaintext and ciphertext
 *     are never returned, logged, or echoed. Pre-existing links may still hold a
 *     legacy bcrypt hash, which the unlock path verifies with the hash library.
 *   • Expiry (`linkExpiresAt`) and revocation (`linkRevokedAt`) are checked on
 *     every access path (meta, unlock, and — via the guard — every session call).
 */
@Injectable()
export class SharingService {
  private readonly logger = new Logger(SharingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sessions: ShareSessionService,
    private readonly signing: SigningService,
    private readonly sendQuota: SendQuotaService,
    private readonly linkPassword: LinkPasswordCipher,
  ) {}

  // --- sender (JWT) --------------------------------------------------------

  /**
   * Mint a new share link for a document the caller owns. Generates a unique
   * access token, encrypts the optional password (reversibly), computes the expiry, and
   * attaches the document's still-unassigned fields to this LINK request so the
   * recipient has something to fill. The response never exposes the password.
   *
   * A share link is a real delivery channel, so the first link on a DRAFT
   * document *dispatches* it exactly like an email send would: it flips the
   * document to 진행 중 (recording `sentAt`) and consumes one Free-plan monthly
   * send. Additional links on an already-dispatched document neither re-count
   * against the quota nor change the status (idempotent DRAFT → 진행 중 only).
   */
  async createLink(
    ownerId: string,
    documentId: string,
    dto: CreateShareLinkDto,
    ip?: string,
  ): Promise<ShareLinkView> {
    const document = await this.requireOwnedDocument(ownerId, documentId);

    // The first link is this contract's dispatch: it must obey the same
    // Free-plan monthly limit as an email send (otherwise links would be a
    // quota bypass). Later links on an already-sent document don't re-count.
    const isFirstDispatch = document.status === DocumentStatus.DRAFT;
    if (isFirstDispatch) {
      await this.sendQuota.assertWithinQuota(ownerId);
    }

    const accessToken = randomBytes(24).toString('hex');
    const password = dto.password?.trim();
    const linkPasswordCipher = password ? this.linkPassword.encrypt(password) : null;
    const linkExpiresAt = this.computeExpiry(dto);
    const linkLabel = dto.label?.trim() || null;

    const link = await this.prisma.$transaction(async (tx) => {
      // Re-check quota inside the transaction to avoid a race past the limit.
      if (isFirstDispatch) {
        await this.sendQuota.assertWithinQuota(ownerId, tx);
      }

      const created = await tx.signRequest.create({
        data: {
          documentId,
          accessMode: SignRequestAccessMode.LINK,
          accessToken,
          status: SignRequestStatus.PENDING,
          linkPasswordCipher,
          linkExpiresAt,
          linkLabel,
        },
      });

      // Connect the document's designated fill fields (those not yet bound to
      // another request) to this link so the recipient can complete them.
      await tx.signField.updateMany({
        where: { documentId, signRequestId: null },
        data: { signRequestId: created.id },
      });

      // Dispatch the contract on its first link: flip DRAFT → 진행 중 and stamp
      // sentAt so the dashboard status and the monthly send count stay in sync
      // with the email path. One-shot: never touches an already 진행 중/완료 doc.
      if (isFirstDispatch) {
        await tx.document.update({
          where: { id: documentId },
          data: { status: DocumentStatus.IN_PROGRESS, sentAt: new Date() },
        });
      }

      await tx.auditLog.create({
        data: {
          documentId,
          signRequestId: created.id,
          actorId: ownerId,
          action: AUDIT_ACTION.CREATED,
          ipAddress: ip,
          // Never persist the password — only whether one is set.
          metadata: {
            hasPassword: linkPasswordCipher != null,
            expiresAt: linkExpiresAt ? linkExpiresAt.toISOString() : null,
            label: linkLabel,
          },
        },
      });

      return created;
    });

    return this.toView(link);
  }

  /** List every share link on a document the caller owns (newest first). */
  async listLinks(ownerId: string, documentId: string): Promise<ShareLinkView[]> {
    await this.requireOwnedDocument(ownerId, documentId);
    const links = await this.prisma.signRequest.findMany({
      where: { documentId, accessMode: SignRequestAccessMode.LINK },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((l) => this.toView(l));
  }

  /** Revoke a share link (idempotent). Owner-only. */
  async revokeLink(
    ownerId: string,
    documentId: string,
    linkId: string,
    ip?: string,
  ): Promise<ShareLinkView> {
    await this.requireOwnedDocument(ownerId, documentId);
    const link = await this.prisma.signRequest.findUnique({ where: { id: linkId } });
    if (
      !link ||
      link.documentId !== documentId ||
      link.accessMode !== SignRequestAccessMode.LINK
    ) {
      throw new NotFoundException(MESSAGES.share.invalidLink);
    }

    // Already revoked → return as-is (idempotent, no duplicate audit).
    if (link.linkRevokedAt) return this.toView(link);

    const updated = await this.prisma.signRequest.update({
      where: { id: linkId },
      data: { linkRevokedAt: new Date() },
    });
    await this.writeAudit({
      documentId,
      signRequestId: linkId,
      actorId: ownerId,
      action: AUDIT_ACTION.REVOKED,
      ip,
    });
    return this.toView(updated);
  }

  /**
   * Reveal a link's current access password to its owner (sender dashboard only).
   *
   * Because grain-1 stores the password as reversible ciphertext, the owner can
   * see the exact plaintext they set. Three states are distinguished so the
   * dashboard can react correctly:
   *   • no password set        → { hasPassword: false, recoverable: false, password: null }
   *   • reversible ciphertext  → { hasPassword: true,  recoverable: true,  password: <plaintext> }
   *   • legacy bcrypt hash     → { hasPassword: true,  recoverable: false, password: null }
   * A pre-migration link still holds a one-way hash whose plaintext cannot be
   * recovered; we report `recoverable: false` (not an error) so the owner can
   * simply overwrite it via {@link updateLinkPassword}.
   *
   * This is intentionally exposed only on the JWT owner-scoped controller — the
   * plaintext is never returned on any public/recipient path.
   */
  async getLinkPassword(
    ownerId: string,
    documentId: string,
    linkId: string,
    ip?: string,
  ): Promise<ShareLinkPasswordView> {
    const link = await this.requireOwnedLink(ownerId, documentId, linkId);
    const stored = link.linkPasswordCipher;
    const hasPassword = stored != null;
    const recoverable = hasPassword && this.linkPassword.isCipherText(stored);
    const password = recoverable ? this.linkPassword.decrypt(stored) : null;

    // Revealing a stored secret is a sensitive read — audit it (never the value).
    await this.writeAudit({
      documentId,
      signRequestId: linkId,
      actorId: ownerId,
      action: AUDIT_ACTION.PASSWORD_VIEWED,
      ip,
      metadata: { hasPassword, recoverable },
    });

    return { hasPassword, recoverable, password };
  }

  /**
   * Replace (or clear) a link's access password. Owner-only. The new password is
   * encrypted with the same reversible scheme as create, so it takes effect
   * immediately: the very next unlock reads the freshly stored ciphertext. An
   * empty/omitted value removes password protection entirely. The password is
   * never returned, logged, or echoed — only whether one is now set.
   */
  async updateLinkPassword(
    ownerId: string,
    documentId: string,
    linkId: string,
    dto: UpdateShareLinkPasswordDto,
    ip?: string,
  ): Promise<ShareLinkView> {
    await this.requireOwnedLink(ownerId, documentId, linkId);
    const next = dto.password?.trim();
    const linkPasswordCipher = next ? this.linkPassword.encrypt(next) : null;

    const updated = await this.prisma.signRequest.update({
      where: { id: linkId },
      data: { linkPasswordCipher },
    });
    await this.writeAudit({
      documentId,
      signRequestId: linkId,
      actorId: ownerId,
      action: AUDIT_ACTION.PASSWORD_UPDATED,
      ip,
      metadata: { hasPassword: linkPasswordCipher != null },
    });
    return this.toView(updated);
  }

  // --- recipient: pre-auth meta (public) -----------------------------------

  /**
   * Minimal pre-auth metadata for the share landing screen. Reveals only the
   * document title, sender branding, whether a password is required, and the
   * expiry — never the PDF or fields. Throws the matching status code for an
   * expired/revoked/invalid link so the recipient sees the right notice.
   */
  async meta(accessToken: string): Promise<ShareMeta> {
    const link = await this.prisma.signRequest.findUnique({
      where: { accessToken },
      select: {
        accessMode: true,
        status: true,
        linkExpiresAt: true,
        linkRevokedAt: true,
        linkPasswordCipher: true,
        document: {
          select: {
            title: true,
            status: true,
            owner: { select: { name: true, brandColor: true, brandLogoUrl: true } },
          },
        },
      },
    });
    assertLinkAccessible(link);

    return {
      documentTitle: link!.document.title,
      sender: {
        name: link!.document.owner.name,
        brandColor: link!.document.owner.brandColor,
        brandLogoUrl: link!.document.owner.brandLogoUrl,
      },
      requiresPassword: link!.linkPasswordCipher != null,
      expiresAt: link!.linkExpiresAt ? link!.linkExpiresAt.toISOString() : null,
      alreadySubmitted: link!.status === SignRequestStatus.SIGNED,
    };
  }

  // --- recipient: unlock → share session (public) --------------------------

  /**
   * Open the link: when a password is set, verify it (decrypt-and-compare for
   * the reversible ciphertext, or hash-library compare for a legacy bcrypt hash,
   * with a minimal share lockout) before issuing a short-lived share session
   * token; when no password is set, issue the session immediately. On success
   * the link flips PENDING→VIEWED and records an UNLOCKED audit event.
   */
  async unlock(
    accessToken: string,
    password: string | undefined,
    ip?: string,
    userAgent?: string,
  ): Promise<UnlockResult> {
    const link = await this.prisma.signRequest.findUnique({
      where: { accessToken },
      select: {
        id: true,
        accessMode: true,
        status: true,
        linkExpiresAt: true,
        linkRevokedAt: true,
        linkPasswordCipher: true,
        document: { select: { status: true } },
      },
    });
    assertLinkAccessible(link);

    if (link!.status === SignRequestStatus.SIGNED) {
      throw new ForbiddenException(MESSAGES.share.alreadySubmitted);
    }
    if (!this.isAccessible(link!.document.status, link!.status)) {
      throw new ForbiddenException(MESSAGES.share.notSignable);
    }

    if (link!.linkPasswordCipher) {
      // Minimal lockout: deny before comparing once recent failures pile up.
      const recentFailures = await this.countRecentUnlockFailures(link!.id);
      if (recentFailures >= SHARE_UNLOCK_MAX_ATTEMPTS) {
        throw new ForbiddenException(MESSAGES.share.locked);
      }
      if (!password) {
        throw new UnauthorizedException(MESSAGES.share.passwordRequired);
      }
      // New links store reversible ciphertext (decrypt-and-compare); links minted
      // before this change still hold a bcrypt hash (hash-library compare).
      const stored = link!.linkPasswordCipher;
      const ok = this.linkPassword.isCipherText(stored)
        ? this.linkPassword.matches(password, stored)
        : await bcrypt.compare(password, stored);
      if (!ok) {
        await this.writeAudit({
          signRequestId: link!.id,
          action: AUDIT_ACTION.UNLOCK_FAILED,
          ip,
          metadata: { userAgent: userAgent ?? null },
        });
        throw new UnauthorizedException(MESSAGES.share.wrongPassword);
      }
    }

    if (link!.status === SignRequestStatus.PENDING) {
      await this.prisma.signRequest.update({
        where: { id: link!.id },
        data: { status: SignRequestStatus.VIEWED },
      });
    }
    await this.writeAudit({
      signRequestId: link!.id,
      action: AUDIT_ACTION.UNLOCKED,
      ip,
      metadata: { userAgent: userAgent ?? null },
    });

    return { sessionToken: this.sessions.issue(link!.id) };
  }

  // --- recipient: working set (share session) ------------------------------

  /**
   * The recipient's working set: their assigned fields (normalized geometry)
   * plus the short-lived API path to stream the PDF. Records a VIEWED audit the
   * first time the document content is actually served.
   */
  async payload(signRequestId: string, accessToken: string): Promise<SharePayload> {
    const link = await this.prisma.signRequest.findUnique({
      where: { id: signRequestId },
      select: {
        status: true,
        document: { select: { title: true, pageCount: true, status: true } },
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
    if (!link) throw new NotFoundException(MESSAGES.share.invalidLink);
    if (link.status === SignRequestStatus.SIGNED) {
      throw new ForbiddenException(MESSAGES.share.alreadySubmitted);
    }
    if (!this.isAccessible(link.document.status, link.status)) {
      throw new ForbiddenException(MESSAGES.share.notSignable);
    }

    await this.recordFirstView(signRequestId);

    return {
      documentTitle: link.document.title,
      pageCount: link.document.pageCount,
      pdfPath: `/api/share/${accessToken}/pdf`,
      fields: link.signFields.map((f) => ({
        id: f.id,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        filled: f.value != null && f.value.length > 0,
        // Expose the persisted value so a resumed recipient session rehydrates the
        // field to its real value instead of a "작성됨" placeholder. `null` when
        // nothing has been saved for this field.
        value: f.value != null && f.value.length > 0 ? f.value : null,
      })),
    };
  }

  /** Stream the document PDF bytes — reuses the signer flow's opener. */
  openPdf(signRequestId: string): Promise<Readable> {
    return this.signing.openPdf(signRequestId);
  }

  /** Persist captured field values — reuses the signer flow's validation. */
  saveFields(signRequestId: string, dto: SaveFieldValuesDto): Promise<{ saved: number }> {
    return this.signing.saveFields(signRequestId, dto);
  }

  /**
   * Finalize the recipient's submission. Reuses the signer completion machine
   * (`SigningService.complete`) verbatim — flip SIGNED, complete the document
   * when last, and enqueue completion post-processing so the **sender** gets the
   * completion notification — then returns the share-flavoured success headline.
   */
  async submit(signRequestId: string, ip?: string, userAgent?: string): Promise<SubmitResult> {
    const result = await this.signing.complete(signRequestId, ip, userAgent);
    return {
      status: result.status,
      documentCompleted: result.documentCompleted,
      message: MESSAGES.share.submitted,
      // Mirror the signer flow's completion facts so the share recipient's
      // completion screen shows the same date/amount/signed-at summary.
      signedAt: result.signedAt,
      contractDate: result.contractDate,
      contractAmount: result.contractAmount,
    };
  }

  // --- internals -----------------------------------------------------------

  /** A link can be opened/filled only while the document is in progress. */
  private isAccessible(documentStatus: DocumentStatus, requestStatus: SignRequestStatus): boolean {
    if (
      requestStatus === SignRequestStatus.SIGNED ||
      requestStatus === SignRequestStatus.DECLINED
    ) {
      return false;
    }
    return (
      documentStatus === DocumentStatus.IN_PROGRESS ||
      documentStatus === DocumentStatus.DRAFT
    );
  }

  /** Compute the absolute expiry (null = never) from the create DTO. */
  private computeExpiry(dto: CreateShareLinkDto): Date | null {
    if (dto.noExpiry) return null;
    const days = dto.expiresInDays ?? SHARE_LINK_DEFAULT_EXPIRY_DAYS;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private async countRecentUnlockFailures(signRequestId: string): Promise<number> {
    const since = new Date(Date.now() - SHARE_UNLOCK_LOCK_WINDOW_MINUTES * 60_000);
    return this.prisma.auditLog.count({
      where: {
        signRequestId,
        action: AUDIT_ACTION.UNLOCK_FAILED,
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

  private async requireOwnedDocument(
    ownerId: string,
    documentId: string,
  ): Promise<{ status: DocumentStatus }> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { ownerId: true, status: true },
    });
    if (!document) throw new NotFoundException(MESSAGES.document.notFound);
    if (document.ownerId !== ownerId) throw new ForbiddenException(MESSAGES.document.forbidden);
    return { status: document.status };
  }

  /**
   * Resolve a LINK request the caller owns, or throw. Enforces ownership (the
   * document belongs to the caller) then that the link exists, belongs to that
   * document, and is actually a LINK request — a non-owner or a bad id never
   * reaches the password read/update logic.
   */
  private async requireOwnedLink(
    ownerId: string,
    documentId: string,
    linkId: string,
  ): Promise<{ linkPasswordCipher: string | null }> {
    await this.requireOwnedDocument(ownerId, documentId);
    const link = await this.prisma.signRequest.findUnique({ where: { id: linkId } });
    if (
      !link ||
      link.documentId !== documentId ||
      link.accessMode !== SignRequestAccessMode.LINK
    ) {
      throw new NotFoundException(MESSAGES.share.invalidLink);
    }
    return link;
  }

  private async writeAudit(input: {
    documentId?: string;
    signRequestId: string;
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

  /** Map a LINK SignRequest row to the sender-facing view (no password/ciphertext). */
  private toView(link: ShareLinkRow): ShareLinkView {
    const state = deriveLinkState(link);
    return {
      id: link.id,
      token: link.accessToken,
      url: `${this.webOrigin()}/share/${link.accessToken}`,
      label: link.linkLabel,
      status: state,
      requiresPassword: link.linkPasswordCipher != null,
      expiresAt: link.linkExpiresAt ? link.linkExpiresAt.toISOString() : null,
      revokedAt: link.linkRevokedAt ? link.linkRevokedAt.toISOString() : null,
      createdAt: link.createdAt.toISOString(),
    };
  }

  private webOrigin(): string {
    return this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
  }
}

// --- shapes ----------------------------------------------------------------

/** The subset of a LINK SignRequest row needed to build a {@link ShareLinkView}. */
interface ShareLinkRow {
  id: string;
  accessToken: string;
  status: SignRequestStatus;
  linkPasswordCipher: string | null;
  linkExpiresAt: Date | null;
  linkRevokedAt: Date | null;
  linkLabel: string | null;
  createdAt: Date;
}

export interface ShareLinkView {
  id: string;
  token: string;
  url: string;
  label: string | null;
  status: ShareLinkState;
  requiresPassword: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * Sender-facing view of a link's password state. `password` carries the plaintext
 * only when it is recoverable (reversible ciphertext); a legacy hash reports
 * `recoverable: false` with a null plaintext.
 */
export interface ShareLinkPasswordView {
  hasPassword: boolean;
  recoverable: boolean;
  password: string | null;
}

export interface ShareMeta {
  documentTitle: string;
  sender: {
    name: string | null;
    brandColor: string | null;
    brandLogoUrl: string | null;
  };
  requiresPassword: boolean;
  expiresAt: string | null;
  alreadySubmitted: boolean;
}

export interface UnlockResult {
  sessionToken: string;
}

export interface SharePayloadField {
  id: string;
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  filled: boolean;
  /** Persisted value (signature dataURL / ISO date / text); null if unfilled. */
  value: string | null;
}

export interface SharePayload {
  documentTitle: string;
  pageCount: number;
  pdfPath: string;
  fields: SharePayloadField[];
}

export interface SubmitResult {
  status: SignRequestStatus;
  documentCompleted: boolean;
  message: string;
  /** ISO timestamp the submission was sealed — the completion "서명 완료 시각". */
  signedAt: string;
  /** Contract date pulled from the PDF ("2026년 1월 1일"), or null if not found. */
  contractDate: string | null;
  /** Contract amount pulled from the PDF ("5,000,000원"), or null if not found. */
  contractAmount: string | null;
}
