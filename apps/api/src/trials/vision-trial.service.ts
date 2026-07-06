import { Injectable, NotFoundException } from '@nestjs/common';
import { Plan, Prisma } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGES, VISION_TRIAL_LIMIT } from '../common/messages';

/**
 * Access policy for the premium Vision/LLM auto-field placement engine.
 *
 * **Premium auto-placement is unlimited for every plan.** Access is always
 * granted and never metered — a FREE account can run the premium engine an
 * unlimited number of times: no trial is consumed, nothing is ever blocked, and
 * no upgrade wall is raised. The former 2-trial cap and its guarded counter
 * update have been retired (see design-spec
 * `vocabulary/premium-trial-states.md` — "프리미엄 무제한" 결정).
 *
 * Plan still matters for one thing only: {@link isPremiumPlan} lets premium
 * accounts identify themselves so the UI can hide the (now-dormant) free-trial
 * note. The `User.visionTrialsUsed` column is left in place but is never
 * incremented — it stays at its stored value forever.
 *
 * This service is the single backend entry point for the access decision so the
 * heuristic→vision orchestration never re-implements the rule. It intentionally
 * does NOT call the engine, touch billing, or render UI — data + policy only.
 */
@Injectable()
export class VisionTrialService {
  constructor(private readonly prisma: PrismaService) {}

  /** PRO/ENTERPRISE are premium (unmetered); FREE is trial-metered. */
  private isPremiumPlan(plan: Plan): boolean {
    return plan !== Plan.FREE;
  }

  /** Load the plan + trial counter, or reject if the user does not exist. */
  private async loadAccount(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ plan: Plan; visionTrialsUsed: number }> {
    const client = tx ?? this.prisma;
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { plan: true, visionTrialsUsed: true },
    });
    if (!user) {
      throw new NotFoundException(MESSAGES.auth.unauthorized);
    }
    return user;
  }

  private remainingFor(used: number): number {
    return Math.max(0, VISION_TRIAL_LIMIT - used);
  }

  /**
   * Detailed trial status for an account. **Dormant display only** — the premium
   * engine is unlimited and never gated, so `remaining`/`exhausted` no longer
   * decide access. They describe the (never-incremented) free-trial balance the
   * UI may show as a note. Premium accounts report `isPremium: true`. Retained so
   * the payload shape stays stable while the web copy is reframed elsewhere.
   */
  async getStatus(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VisionTrialStatus> {
    const { plan, visionTrialsUsed } = await this.loadAccount(userId, tx);
    const remaining = this.remainingFor(visionTrialsUsed);
    return {
      plan,
      isPremium: this.isPremiumPlan(plan),
      used: Math.min(visionTrialsUsed, VISION_TRIAL_LIMIT),
      limit: VISION_TRIAL_LIMIT,
      remaining,
      exhausted: remaining === 0,
    };
  }

  /** Remaining free trials for the account (0..VISION_TRIAL_LIMIT). */
  async remaining(userId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const { visionTrialsUsed } = await this.loadAccount(userId, tx);
    return this.remainingFor(visionTrialsUsed);
  }

  /**
   * Whether the account's free trials are all used up. Premium status is
   * irrelevant here — this is strictly about the trial balance. Use
   * {@link canUseVisionEngine} for the actual access decision.
   */
  async isExhausted(userId: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    return (await this.remaining(userId, tx)) === 0;
  }

  /**
   * Single entry point — may this account use the premium Vision engine right
   * now? Read-only. **Always `allowed`**: premium auto-placement is unlimited for
   * every plan, so this never blocks and never consumes a trial. `reason` is
   * `premium` for a premium plan and `unlimited` for everyone else (both mean
   * "allowed"). `remaining` reports the dormant balance for an optional UI note.
   */
  async canUseVisionEngine(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VisionAvailability> {
    const { plan, visionTrialsUsed } = await this.loadAccount(userId, tx);
    const isPremium = this.isPremiumPlan(plan);
    return {
      allowed: true,
      isPremium,
      remaining: this.remainingFor(visionTrialsUsed),
      reason: isPremium ? 'premium' : 'unlimited',
    };
  }

  /**
   * Access decision at the moment of the consent-driven run — the entry point the
   * orchestration uses right before invoking the engine. **Always `allowed` and
   * never consumes** a trial (premium auto-placement is unlimited for every
   * plan), so `consumedTrial` is always `false`. Kept as the single seam the
   * run path calls so the "read the plan/balance, then run" shape is preserved.
   */
  async acquireVisionUse(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VisionAvailability & { consumedTrial: boolean }> {
    const { plan, visionTrialsUsed } = await this.loadAccount(userId, tx);
    const isPremium = this.isPremiumPlan(plan);
    return {
      allowed: true,
      isPremium,
      remaining: this.remainingFor(visionTrialsUsed),
      reason: isPremium ? 'premium' : 'unlimited',
      consumedTrial: false,
    };
  }
}

/**
 * Why the Vision engine is available for an account. Both values mean "allowed":
 * `premium` (premium plan) and `unlimited` (every other plan — premium
 * auto-placement is unlimited and no longer trial-metered).
 */
export type VisionAccessReason = 'premium' | 'unlimited';

/** Read-only access decision for the premium Vision engine (always allowed). */
export interface VisionAvailability {
  /** Whether the account may run the Vision engine. Always `true` (unlimited). */
  allowed: boolean;
  /** Premium (PRO/ENTERPRISE) accounts identify themselves to hide the trial note. */
  isPremium: boolean;
  /** Dormant free-trial balance for an optional UI note (never gates access). */
  remaining: number;
  /** Which rule drove the (always-allowed) decision. */
  reason: VisionAccessReason;
}

/** Detailed free-trial meter status for an account. */
export interface VisionTrialStatus {
  plan: Plan;
  isPremium: boolean;
  /** Trials consumed so far, clamped to `limit`. */
  used: number;
  /** Total free-trial allowance (VISION_TRIAL_LIMIT). */
  limit: number;
  /** Remaining free trials. */
  remaining: number;
  /** True once the free-trial balance hits zero (ignores premium status). */
  exhausted: boolean;
}
