import { ForbiddenException, Injectable } from '@nestjs/common';
import { Plan, Prisma } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { FREE_PLAN_MONTHLY_LIMIT, MESSAGES } from './messages';

/**
 * Shared Free-plan monthly send quota.
 *
 * A "send" (dispatch) is any path that turns a DRAFT contract into an active one
 * for a recipient — whether by emailing signers (`DocumentsService.send`) or by
 * minting a self-serve share link (`SharingService.createLink`). Both consume
 * the same monthly allowance, so the counting + limit logic lives here once and
 * is injected wherever a dispatch happens (avoids drift between the two paths).
 *
 * A document is counted at most once: the quota is derived from `Document.sentAt`
 * (set on the DRAFT → 진행 중 transition), so additional links on an already
 * dispatched document don't consume more allowance.
 */
@Injectable()
export class SendQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reject when the owner is on the Free plan and has already used this
   * calendar month's allowance. Paid plans are unmetered here. Pass a
   * transaction client to re-check inside a transaction and avoid a race past
   * the limit. Surfaces the shared user-facing copy (`send.quotaExceeded`).
   */
  async assertWithinQuota(ownerId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    const user = await client.user.findUnique({ where: { id: ownerId }, select: { plan: true } });
    if (user?.plan && user.plan !== Plan.FREE) return; // Paid plans are unmetered here.

    const used = await this.monthlySendCount(ownerId, tx);
    if (used >= FREE_PLAN_MONTHLY_LIMIT) {
      throw new ForbiddenException(MESSAGES.send.quotaExceeded);
    }
  }

  /** Documents dispatched by this owner in the current calendar month (UTC). */
  async monthlySendCount(ownerId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const client = tx ?? this.prisma;
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return client.document.count({
      where: { ownerId, sentAt: { gte: startOfMonth } },
    });
  }

  /** Remaining Free-plan sends this calendar month. */
  async quota(ownerId: string): Promise<{ used: number; limit: number; remaining: number }> {
    const used = await this.monthlySendCount(ownerId);
    return {
      used,
      limit: FREE_PLAN_MONTHLY_LIMIT,
      remaining: Math.max(0, FREE_PLAN_MONTHLY_LIMIT - used),
    };
  }
}
