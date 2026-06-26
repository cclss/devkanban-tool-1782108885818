import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { VerificationChannel, VerificationPurpose } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { maskEmail } from '../common/masking';
import {
  renderFindIdCodeEmail,
  renderFindIdResultEmail,
} from '../email/find-id.template';
import {
  FIND_ID_CODE_TTL_MINUTES,
  FIND_ID_REQUEST_MAX_PER_WINDOW,
  FIND_ID_REQUEST_WINDOW_MINUTES,
  MESSAGES,
  SIGNER_VERIFY_LOCK_WINDOW_MINUTES,
  SIGNER_VERIFY_MAX_ATTEMPTS,
} from '../common/messages';
import type { FindIdChannel, FindIdRequestDto, FindIdVerifyDto } from './dto/find-id.dto';

export interface FindIdRequestResult {
  /** Always-generic acknowledgement (never reveals whether an account matched). */
  message: string;
}

export interface FindIdVerifyResult {
  message: string;
  /** Masked recovered ID — the full ID is delivered out of band, never echoed. */
  maskedId: string;
}

/**
 * "Find ID" account-recovery flow.
 *
 * Security posture (Done-when):
 *  - Generic responses — `request` returns the same acknowledgement whether or
 *    not an account matched, so the API never leaks account existence.
 *  - Codes are stored only as a SHA-256 hash and compared in constant time.
 *  - Codes expire (5분) and are single-use (`consumedAt`).
 *  - Verify uses a sliding-window lockout reusing the signer policy (5회/15분);
 *    request uses a per-target throttle to blunt spam / mail-bombing.
 *  - Both channels (email via `EmailService`, SMS via `NotificationsService`
 *    alimtalk) degrade to a console fallback and never throw.
 */
@Injectable()
export class FindIdService {
  private readonly logger = new Logger(FindIdService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  // --- request: send a verification code (generic response) ----------------

  async request(dto: FindIdRequestDto): Promise<FindIdRequestResult> {
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
        const expiresAt = new Date(Date.now() + FIND_ID_CODE_TTL_MINUTES * 60_000);
        await this.prisma.identityVerification.create({
          data: {
            purpose: VerificationPurpose.FIND_ID,
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
    return { message: MESSAGES.findId.requestAccepted };
  }

  // --- verify: check the code, deliver + return the (masked) ID ------------

  async verify(dto: FindIdVerifyDto): Promise<FindIdVerifyResult> {
    const channel = toVerificationChannel(dto.channel);
    const target = dto.target;

    // Sliding-window lockout (shared 5회/15분 policy) — deny before comparing.
    const recentFailures = await this.countRecentFailures(channel, target);
    if (recentFailures >= SIGNER_VERIFY_MAX_ATTEMPTS) {
      throw new ForbiddenException(MESSAGES.findId.locked);
    }

    // Latest unconsumed challenge for this target. Absence is indistinguishable
    // from a wrong code (no account enumeration).
    const challenge = await this.prisma.identityVerification.findFirst({
      where: {
        purpose: VerificationPurpose.FIND_ID,
        channel,
        target,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true, name: true, phoneNumber: true } } },
    });
    if (!challenge) {
      throw new BadRequestException(MESSAGES.findId.codeMismatch);
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(MESSAGES.findId.codeExpired);
    }

    const matches = safeEqualHex(this.hashCode(dto.code), challenge.codeHash);
    if (!matches) {
      await this.prisma.identityVerification.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException(MESSAGES.findId.codeMismatch);
    }

    // Atomically consume exactly once (guards against a double-submit race).
    const consumed = await this.prisma.identityVerification.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0 || !challenge.user) {
      throw new BadRequestException(MESSAGES.findId.codeMismatch);
    }

    // Deliver the full ID out of band over the just-verified channel.
    await this.deliverId(dto.channel, challenge.user.email, challenge.user.phoneNumber, challenge.user.name);

    return {
      message: MESSAGES.findId.verified,
      maskedId: maskEmail(challenge.user.email),
    };
  }

  // --- internals -----------------------------------------------------------

  private async findUser(
    channel: FindIdChannel,
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
    const since = new Date(Date.now() - FIND_ID_REQUEST_WINDOW_MINUTES * 60_000);
    const recent = await this.prisma.identityVerification.count({
      where: {
        purpose: VerificationPurpose.FIND_ID,
        channel,
        target,
        createdAt: { gte: since },
      },
    });
    return recent >= FIND_ID_REQUEST_MAX_PER_WINDOW;
  }

  private async countRecentFailures(
    channel: VerificationChannel,
    target: string,
  ): Promise<number> {
    const since = new Date(Date.now() - SIGNER_VERIFY_LOCK_WINDOW_MINUTES * 60_000);
    const agg = await this.prisma.identityVerification.aggregate({
      _sum: { attempts: true },
      where: {
        purpose: VerificationPurpose.FIND_ID,
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

  /** Send the verification code over the requested channel (never throws). */
  private async deliverCode(
    channel: FindIdChannel,
    target: string,
    name: string | null,
    code: string,
  ): Promise<void> {
    if (channel === 'email') {
      const rendered = renderFindIdCodeEmail({ code });
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
      template: 'find_id_code',
      data: { message: MESSAGES.findId.sms.code(code), code },
    });
  }

  /** Send the recovered full ID over the verified channel (never throws). */
  private async deliverId(
    channel: FindIdChannel,
    accountEmail: string,
    phoneNumber: string | null,
    name: string | null,
  ): Promise<void> {
    if (channel === 'email') {
      const rendered = renderFindIdResultEmail({ accountId: accountEmail });
      await this.email.send({
        to: [{ email: accountEmail, name }],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      return;
    }
    // SMS channel: send to the verified phone number (fallback to the email
    // address only as a defensive default — phone is always present here).
    await this.notifications.enqueue({
      channel: 'alimtalk',
      to: phoneNumber ?? accountEmail,
      toName: name,
      template: 'find_id_result',
      data: { message: MESSAGES.findId.sms.result(accountEmail), accountId: accountEmail },
    });
  }
}

// --- pure helpers ----------------------------------------------------------

function toVerificationChannel(channel: FindIdChannel): VerificationChannel {
  return channel === 'email' ? VerificationChannel.EMAIL : VerificationChannel.SMS;
}

/** Six-digit, zero-padded numeric code. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Constant-time compare of two equal-length hex digests. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
