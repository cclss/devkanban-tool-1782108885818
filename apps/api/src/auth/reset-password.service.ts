import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { VerificationChannel, VerificationPurpose } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  renderResetPasswordCodeEmail,
  renderResetPasswordDoneEmail,
} from '../email/reset-password.template';
import {
  MESSAGES,
  RESET_PASSWORD_CODE_TTL_MINUTES,
  RESET_PASSWORD_REQUEST_MAX_PER_WINDOW,
  RESET_PASSWORD_REQUEST_WINDOW_MINUTES,
  RESET_PASSWORD_TOKEN_TTL_MINUTES,
  SIGNER_VERIFY_LOCK_WINDOW_MINUTES,
  SIGNER_VERIFY_MAX_ATTEMPTS,
} from '../common/messages';
import type {
  ResetPasswordChannel,
  ResetPasswordConfirmDto,
  ResetPasswordRequestDto,
  ResetPasswordVerifyDto,
} from './dto/reset-password.dto';

// Same cost factor as AuthService — a password set here must be indistinguishable
// from one created at registration.
const BCRYPT_ROUNDS = 10;

export interface ResetPasswordRequestResult {
  /** Always-generic acknowledgement (never reveals whether an account matched). */
  message: string;
}

export interface ResetPasswordVerifyResult {
  message: string;
  /**
   * High-entropy reset token, returned in plaintext exactly once. Only its hash
   * is persisted; the client must present this to `confirm` to set a new
   * password.
   */
  resetToken: string;
}

export interface ResetPasswordConfirmResult {
  message: string;
}

/**
 * Password-reset flow (request → verify → confirm).
 *
 * Security posture (Done-when), mirroring {@link FindIdService}:
 *  - Generic responses — `request` returns the same acknowledgement whether or
 *    not an account matched, so the API never leaks account existence.
 *  - Verification codes are stored only as a SHA-256 hash and compared in
 *    constant time; they expire (5분) and are single-use (`consumedAt`).
 *  - `verify` uses a sliding-window lockout (shared signer policy 5회/15분) and
 *    `request` a per-target throttle to blunt spam / mail-bombing.
 *  - On successful verify a high-entropy reset token is minted; only its hash is
 *    stored (short TTL) and the plaintext is returned once.
 *  - `confirm` looks the token up by hash, atomically consumes it (single-use
 *    replay guard), bcrypt-hashes the new password, and invalidates any other
 *    outstanding reset tokens for the user.
 */
@Injectable()
export class ResetPasswordService {
  private readonly logger = new Logger(ResetPasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  // --- request: send a verification code (generic response) ----------------

  async request(dto: ResetPasswordRequestDto): Promise<ResetPasswordRequestResult> {
    const channel = toVerificationChannel(dto.channel);
    const target = dto.target; // already normalized by the DTO transform.

    // Per-target spam throttle. Capped regardless of account existence; on
    // overflow we silently skip sending but keep the response generic.
    const throttled = await this.isRequestThrottled(channel, target);
    if (!throttled) {
      const user = await this.findUser(dto.channel, target);
      // Only matched targets get a code generated, stored, and delivered.
      if (user) {
        const code = generateCode();
        const expiresAt = new Date(
          Date.now() + RESET_PASSWORD_CODE_TTL_MINUTES * 60_000,
        );
        await this.prisma.identityVerification.create({
          data: {
            purpose: VerificationPurpose.RESET_PASSWORD,
            channel,
            target,
            codeHash: this.hashCode(code),
            userId: user.id,
            expiresAt,
          },
        });
        await this.deliverCode(dto.channel, target, user.name, code);
      }
    }

    // Always the same acknowledgement.
    return { message: MESSAGES.resetPassword.requestAccepted };
  }

  // --- verify: check the code, mint a single-use reset token ----------------

  async verify(dto: ResetPasswordVerifyDto): Promise<ResetPasswordVerifyResult> {
    const channel = toVerificationChannel(dto.channel);
    const target = dto.target;

    // Sliding-window lockout (shared 5회/15분 policy) — deny before comparing.
    const recentFailures = await this.countRecentFailures(channel, target);
    if (recentFailures >= SIGNER_VERIFY_MAX_ATTEMPTS) {
      throw new ForbiddenException(MESSAGES.resetPassword.locked);
    }

    // Latest unconsumed challenge for this target. Absence is indistinguishable
    // from a wrong code (no account enumeration).
    const challenge = await this.prisma.identityVerification.findFirst({
      where: {
        purpose: VerificationPurpose.RESET_PASSWORD,
        channel,
        target,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true } } },
    });
    if (!challenge) {
      throw new BadRequestException(MESSAGES.resetPassword.codeMismatch);
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(MESSAGES.resetPassword.codeExpired);
    }

    const matches = safeEqualHex(this.hashCode(dto.code), challenge.codeHash);
    if (!matches) {
      await this.prisma.identityVerification.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException(MESSAGES.resetPassword.codeMismatch);
    }

    // Atomically consume exactly once (guards against a double-submit race).
    const consumed = await this.prisma.identityVerification.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0 || !challenge.user) {
      throw new BadRequestException(MESSAGES.resetPassword.codeMismatch);
    }

    // Mint a high-entropy reset token; persist only its hash with a short TTL.
    const resetToken = generateResetToken();
    const expiresAt = new Date(
      Date.now() + RESET_PASSWORD_TOKEN_TTL_MINUTES * 60_000,
    );
    await this.prisma.passwordResetToken.create({
      data: {
        userId: challenge.user.id,
        tokenHash: this.hashToken(resetToken),
        expiresAt,
      },
    });

    return { message: MESSAGES.resetPassword.verified, resetToken };
  }

  // --- confirm: set the new password using the single-use reset token -------

  async confirm(dto: ResetPasswordConfirmDto): Promise<ResetPasswordConfirmResult> {
    const tokenHash = this.hashToken(dto.token);

    // Look up the (unconsumed) token by its hash. Absence / expiry / prior use
    // are all surfaced as the same generic "invalid" message.
    const token = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash, consumedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true, name: true, phoneNumber: true } } },
    });
    if (!token || token.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(MESSAGES.resetPassword.tokenInvalid);
    }

    // Atomically consume exactly this token (single-use replay guard).
    const consumed = await this.prisma.passwordResetToken.updateMany({
      where: { id: token.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0 || !token.user) {
      throw new BadRequestException(MESSAGES.resetPassword.tokenInvalid);
    }

    // One-way hash the new password (bcrypt, same cost as registration).
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: token.user.id },
      data: { passwordHash },
    });

    // Invalidate any other outstanding reset tokens for this user so a second,
    // still-valid token can't be replayed after the password has changed.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: token.user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    // Best-effort "password changed" security notice (never throws).
    await this.deliverDone(token.user.email, token.user.name);

    return { message: MESSAGES.resetPassword.completed };
  }

  // --- internals -----------------------------------------------------------

  private async findUser(
    channel: ResetPasswordChannel,
    target: string,
  ): Promise<{ id: string; name: string | null } | null> {
    const where =
      channel === 'email' ? { email: target } : { phoneNumber: target };
    return this.prisma.user.findUnique({
      where,
      select: { id: true, name: true },
    });
  }

  private async isRequestThrottled(
    channel: VerificationChannel,
    target: string,
  ): Promise<boolean> {
    const since = new Date(
      Date.now() - RESET_PASSWORD_REQUEST_WINDOW_MINUTES * 60_000,
    );
    const recent = await this.prisma.identityVerification.count({
      where: {
        purpose: VerificationPurpose.RESET_PASSWORD,
        channel,
        target,
        createdAt: { gte: since },
      },
    });
    return recent >= RESET_PASSWORD_REQUEST_MAX_PER_WINDOW;
  }

  private async countRecentFailures(
    channel: VerificationChannel,
    target: string,
  ): Promise<number> {
    const since = new Date(
      Date.now() - SIGNER_VERIFY_LOCK_WINDOW_MINUTES * 60_000,
    );
    const agg = await this.prisma.identityVerification.aggregate({
      _sum: { attempts: true },
      where: {
        purpose: VerificationPurpose.RESET_PASSWORD,
        channel,
        target,
        updatedAt: { gte: since },
      },
    });
    return agg._sum.attempts ?? 0;
  }

  /** SHA-256 (hex) of the code with an optional server pepper. */
  private hashCode(code: string): string {
    const pepper = this.config.get<string>('IDENTITY_CODE_PEPPER') ?? '';
    return createHash('sha256').update(`${pepper}:${code}`).digest('hex');
  }

  /** SHA-256 (hex) digest of the reset token (high-entropy; stored hash-only). */
  private hashToken(token: string): string {
    const pepper = this.config.get<string>('IDENTITY_CODE_PEPPER') ?? '';
    return createHash('sha256').update(`${pepper}:reset:${token}`).digest('hex');
  }

  /** Send the verification code over the requested channel (never throws). */
  private async deliverCode(
    channel: ResetPasswordChannel,
    target: string,
    name: string | null,
    code: string,
  ): Promise<void> {
    if (channel === 'email') {
      const rendered = renderResetPasswordCodeEmail({ code });
      await this.email.send({
        to: [{ email: target, name }],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      return;
    }
    await this.notifications.enqueue({
      channel: 'alimtalk',
      to: target,
      toName: name,
      template: 'reset_password_code',
      data: { message: MESSAGES.resetPassword.sms.code(code), code },
    });
  }

  /** Send the "password changed" security notice to the account email (never throws). */
  private async deliverDone(
    accountEmail: string,
    name: string | null,
  ): Promise<void> {
    const rendered = renderResetPasswordDoneEmail();
    await this.email.send({
      to: [{ email: accountEmail, name }],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }
}

// --- pure helpers ----------------------------------------------------------

function toVerificationChannel(channel: ResetPasswordChannel): VerificationChannel {
  return channel === 'email' ? VerificationChannel.EMAIL : VerificationChannel.SMS;
}

/** Six-digit, zero-padded numeric code. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** 256-bit, URL-safe-ish hex reset token. */
function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

/** Constant-time compare of two equal-length hex digests. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
