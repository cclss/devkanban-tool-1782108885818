import { NotFoundException } from '@nestjs/common';
import { VisionTrialService } from './vision-trial.service';
import { VISION_TRIAL_LIMIT } from '../common/messages';

/**
 * Unit tests for the Vision/LLM access policy.
 *
 * Premium auto-placement is **unlimited for every plan**: access is always
 * granted, no trial is ever consumed, and nothing is blocked. These tests assert
 * that a FREE account is allowed regardless of its (dormant) trial balance, that
 * the `visionTrialsUsed` counter is never incremented, and that the dormant
 * `getStatus` display still reports the stored balance.
 *
 * PrismaService is replaced by a tiny in-memory store.
 */

type MockUser = { id: string; plan: string; visionTrialsUsed: number };

function makeService(users: MockUser[]) {
  const store = users.map((u) => ({ ...u }));

  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const u = store.find((x) => x.id === where.id);
        if (!u) return null;
        // Honour `select` shape so the service only sees requested fields.
        if (select) {
          const out: any = {};
          for (const k of Object.keys(select)) out[k] = (u as any)[k];
          return out;
        }
        return { ...u };
      }),
      // Atomic guarded increment — mirrors Postgres row-lock semantics: the
      // read + write happen with no interleaving await, so concurrent callers
      // serialize and re-evaluate the guard against the latest value.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const u = store.find((x) => x.id === where.id);
        if (!u) return { count: 0 };
        const guard = where.visionTrialsUsed?.lt;
        if (guard !== undefined && !(u.visionTrialsUsed < guard)) {
          return { count: 0 };
        }
        if (data.visionTrialsUsed?.increment !== undefined) {
          u.visionTrialsUsed += data.visionTrialsUsed.increment;
        }
        return { count: 1 };
      }),
    },
  };

  const service = new VisionTrialService(prisma as never);
  return { service, prisma, store };
}

const FREE = (visionTrialsUsed = 0): MockUser => ({ id: 'u1', plan: 'FREE', visionTrialsUsed });
const PRO = (visionTrialsUsed = 0): MockUser => ({ id: 'u1', plan: 'PRO', visionTrialsUsed });

describe('VisionTrialService', () => {
  it('sanity-checks the configured free-trial limit', () => {
    expect(VISION_TRIAL_LIMIT).toBe(2);
  });

  describe('getStatus / remaining / isExhausted', () => {
    it('reports a full balance for a fresh FREE account', async () => {
      const { service } = makeService([FREE(0)]);
      expect(await service.getStatus('u1')).toEqual({
        plan: 'FREE',
        isPremium: false,
        used: 0,
        limit: 2,
        remaining: 2,
        exhausted: false,
      });
      expect(await service.remaining('u1')).toBe(2);
      expect(await service.isExhausted('u1')).toBe(false);
    });

    it('reports a partially-used balance', async () => {
      const { service } = makeService([FREE(1)]);
      const status = await service.getStatus('u1');
      expect(status.used).toBe(1);
      expect(status.remaining).toBe(1);
      expect(status.exhausted).toBe(false);
    });

    it('reports exhaustion once the balance hits zero', async () => {
      const { service } = makeService([FREE(2)]);
      expect(await service.remaining('u1')).toBe(0);
      expect(await service.isExhausted('u1')).toBe(true);
      expect((await service.getStatus('u1')).exhausted).toBe(true);
    });

    it('clamps used/remaining even if the counter somehow overshoots', async () => {
      const { service } = makeService([FREE(5)]);
      const status = await service.getStatus('u1');
      expect(status.used).toBe(2); // clamped to limit
      expect(status.remaining).toBe(0);
    });

    it('rejects an unknown user', async () => {
      const { service } = makeService([]);
      await expect(service.getStatus('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('canUseVisionEngine (read-only decision) — unlimited', () => {
    it('allows a FREE account with a full balance (reason: unlimited)', async () => {
      const { service } = makeService([FREE(1)]);
      expect(await service.canUseVisionEngine('u1')).toEqual({
        allowed: true,
        isPremium: false,
        remaining: 1,
        reason: 'unlimited',
      });
    });

    it('still allows a FREE account with a zero dormant balance (never blocked)', async () => {
      const { service } = makeService([FREE(2)]);
      expect(await service.canUseVisionEngine('u1')).toEqual({
        allowed: true,
        isPremium: false,
        remaining: 0,
        reason: 'unlimited',
      });
    });

    it('allows a premium account (reason: premium)', async () => {
      const { service } = makeService([PRO(2)]);
      const decision = await service.canUseVisionEngine('u1');
      expect(decision.allowed).toBe(true);
      expect(decision.isPremium).toBe(true);
      expect(decision.reason).toBe('premium');
    });

    it('does not consume a trial when only checking', async () => {
      const { service, store } = makeService([FREE(0)]);
      await service.canUseVisionEngine('u1');
      await service.canUseVisionEngine('u1');
      expect(store[0].visionTrialsUsed).toBe(0);
    });

    it('rejects an unknown user', async () => {
      const { service } = makeService([]);
      await expect(service.canUseVisionEngine('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('acquireVisionUse (access at run time) — unlimited, never charges', () => {
    it('allows premium without consuming a trial', async () => {
      const { service, store } = makeService([PRO(0)]);
      const res = await service.acquireVisionUse('u1');
      expect(res).toEqual({
        allowed: true,
        isPremium: true,
        remaining: 2,
        reason: 'premium',
        consumedTrial: false,
      });
      expect(store[0].visionTrialsUsed).toBe(0);
    });

    it('allows a FREE account without consuming a trial (unlimited)', async () => {
      const { service, store } = makeService([FREE(0)]);
      const first = await service.acquireVisionUse('u1');
      expect(first).toEqual({
        allowed: true,
        isPremium: false,
        remaining: 2,
        reason: 'unlimited',
        consumedTrial: false,
      });
      // Repeated runs never charge and never block — the balance is untouched.
      const second = await service.acquireVisionUse('u1');
      expect(second.allowed).toBe(true);
      expect(second.consumedTrial).toBe(false);
      expect(second.remaining).toBe(2);
      expect(store[0].visionTrialsUsed).toBe(0);
    });

    it('allows a FREE account even with a zero dormant balance (never blocked)', async () => {
      const { service, store } = makeService([FREE(2)]);
      const res = await service.acquireVisionUse('u1');
      expect(res).toEqual({
        allowed: true,
        isPremium: false,
        remaining: 0,
        reason: 'unlimited',
        consumedTrial: false,
      });
      expect(store[0].visionTrialsUsed).toBe(2); // never touched
    });

    it('allows every one of many runs without charging (unlimited)', async () => {
      const { service, store } = makeService([FREE(0)]);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => service.acquireVisionUse('u1')),
      );
      expect(results.every((r) => r.allowed && !r.consumedTrial)).toBe(true);
      expect(store[0].visionTrialsUsed).toBe(0); // never incremented
    });

    it('rejects an unknown user', async () => {
      const { service } = makeService([]);
      await expect(service.acquireVisionUse('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
