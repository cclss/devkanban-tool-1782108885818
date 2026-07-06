import { Injectable, NotFoundException } from '@nestjs/common';
import { Plan, Prisma } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGES, VISION_TRIAL_LIMIT } from '../common/messages';

/**
 * Persistent free-trial meter + access policy for the premium Vision/LLM
 * auto-field placement engine.
 *
 * Two independent inputs decide whether an account may run the premium engine:
 *   1. Plan — PRO/ENTERPRISE are premium and unmetered (always allowed).
 *   2. Free-trial balance — a FREE-plan account gets VISION_TRIAL_LIMIT (2)
 *      trials, tracked by `User.visionTrialsUsed`.
 *
 * This service is the single backend entry point for that decision so the
 * heuristic→vision orchestration (grain-4) never re-implements the plan/trial
 * rules. It intentionally does NOT call the engine, touch billing, or render
 * UI — data + policy only.
 *
 * Concurrency: {@link consumeTrial} increments the counter with a guarded
 * `updateMany` (WHERE visionTrialsUsed < limit). Postgres takes a row lock per
 * UPDATE, so two concurrent consumes serialize and the second re-evaluates the
 * guard against the already-incremented value — the 2-trial cap can never be
 * exceeded, even under a burst of simultaneous requests.
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
   * Detailed trial status for an account. `remaining`/`exhausted` describe the
   * free-trial balance only; premium accounts report `isPremium: true` and are
   * never blocked regardless of the balance.
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
   * now? Read-only (does not consume a trial), for preflight checks and UI copy
   * upstream. Allowed when the account is premium OR still has free trials.
   */
  async canUseVisionEngine(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VisionAvailability> {
    const { plan, visionTrialsUsed } = await this.loadAccount(userId, tx);
    const remaining = this.remainingFor(visionTrialsUsed);
    if (this.isPremiumPlan(plan)) {
      return { allowed: true, isPremium: true, remaining, reason: 'premium' };
    }
    if (remaining > 0) {
      return { allowed: true, isPremium: false, remaining, reason: 'trial' };
    }
    return { allowed: false, isPremium: false, remaining: 0, reason: 'exhausted' };
  }

  /**
   * Atomically consume one free trial. Returns whether a trial was actually
   * charged and the balance afterwards.
   *
   * The guarded `updateMany` only increments while `visionTrialsUsed <
   * VISION_TRIAL_LIMIT`, so `count === 1` means this call won the slot and
   * `count === 0` means the account was already at the cap. This is the atomic
   * primitive that keeps concurrent requests from over-charging past 2.
   *
   * This touches the counter regardless of plan; premium accounts should be
   * short-circuited before calling (see {@link acquireVisionUse}).
   */
  async consumeTrial(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ consumed: boolean; remaining: number }> {
    const client = tx ?? this.prisma;
    // Ensure the account exists (and 404 otherwise) before the guarded update.
    await this.loadAccount(userId, tx);
    const result = await client.user.updateMany({
      where: { id: userId, visionTrialsUsed: { lt: VISION_TRIAL_LIMIT } },
      data: { visionTrialsUsed: { increment: 1 } },
    });
    const remaining = await this.remaining(userId, tx);
    return { consumed: result.count === 1, remaining };
  }

  /**
   * Atomic access + charge in one call — the entry point grain-4 uses right
   * before invoking the engine. Premium accounts are allowed without consuming
   * a trial; FREE accounts consume one trial atomically and are allowed only if
   * the consume succeeded. `consumedTrial` tells the caller whether a trial was
   * spent (so it can surface the updated remaining count).
   */
  async acquireVisionUse(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VisionAvailability & { consumedTrial: boolean }> {
    const { plan, visionTrialsUsed } = await this.loadAccount(userId, tx);
    if (this.isPremiumPlan(plan)) {
      return {
        allowed: true,
        isPremium: true,
        remaining: this.remainingFor(visionTrialsUsed),
        reason: 'premium',
        consumedTrial: false,
      };
    }
    const { consumed, remaining } = await this.consumeTrial(userId, tx);
    if (consumed) {
      return { allowed: true, isPremium: false, remaining, reason: 'trial', consumedTrial: true };
    }
    return { allowed: false, isPremium: false, remaining: 0, reason: 'exhausted', consumedTrial: false };
  }
}

/** Why the Vision engine is (or isn't) available for an account. */
export type VisionAccessReason = 'premium' | 'trial' | 'exhausted';

/** Read-only access decision for the premium Vision engine. */
export interface VisionAvailability {
  /** Whether the account may run the Vision engine. */
  allowed: boolean;
  /** Premium (PRO/ENTERPRISE) accounts are unmetered. */
  isPremium: boolean;
  /** Remaining free trials (0 for premium-only allowance or exhausted). */
  remaining: number;
  /** Which rule drove the decision. */
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
