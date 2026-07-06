import { NotFoundException } from '@nestjs/common';
import { VisionTrialService } from './vision-trial.service';
import { VISION_TRIAL_LIMIT } from '../common/messages';

/**
 * Unit tests for the Vision/LLM free-trial meter + access policy.
 *
 * PrismaService is replaced by a tiny in-memory store. The key fidelity point is
 * `updateMany`: it applies the WHERE guard and increments *synchronously* (no
 * await between the read and the write), which is exactly how a Postgres guarded
 * `UPDATE ... WHERE visionTrialsUsed < limit` behaves under a row lock. That lets
 * the concurrency test below meaningfully exercise the over-charge protection.
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

  describe('canUseVisionEngine (read-only decision)', () => {
    it('allows a FREE account with trials left (reason: trial)', async () => {
      const { service } = makeService([FREE(1)]);
      expect(await service.canUseVisionEngine('u1')).toEqual({
        allowed: true,
        isPremium: false,
        remaining: 1,
        reason: 'trial',
      });
    });

    it('blocks a FREE account with no trials left (reason: exhausted)', async () => {
      const { service } = makeService([FREE(2)]);
      expect(await service.canUseVisionEngine('u1')).toEqual({
        allowed: false,
        isPremium: false,
        remaining: 0,
        reason: 'exhausted',
      });
    });

    it('allows a premium account regardless of trial balance (reason: premium)', async () => {
      const { service } = makeService([PRO(2)]); // trials fully "used", but premium
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
  });

  describe('consumeTrial (atomic charge)', () => {
    it('charges one trial and reports the new balance', async () => {
      const { service, store } = makeService([FREE(0)]);
      expect(await service.consumeTrial('u1')).toEqual({ consumed: true, remaining: 1 });
      expect(store[0].visionTrialsUsed).toBe(1);
      expect(await service.consumeTrial('u1')).toEqual({ consumed: true, remaining: 0 });
      expect(store[0].visionTrialsUsed).toBe(2);
    });

    it('refuses to charge past the limit (no over-decrement)', async () => {
      const { service, store } = makeService([FREE(2)]);
      expect(await service.consumeTrial('u1')).toEqual({ consumed: false, remaining: 0 });
      expect(store[0].visionTrialsUsed).toBe(2); // unchanged
    });

    it('never exceeds the limit under concurrent consume requests', async () => {
      const { service, store, prisma } = makeService([FREE(0)]);

      // Fire far more concurrent consumes than the allowance.
      const attempts = 10;
      const results = await Promise.all(
        Array.from({ length: attempts }, () => service.consumeTrial('u1')),
      );

      const charged = results.filter((r) => r.consumed).length;
      expect(charged).toBe(VISION_TRIAL_LIMIT); // exactly 2 succeeded
      expect(store[0].visionTrialsUsed).toBe(VISION_TRIAL_LIMIT); // capped at 2, no over-decrement
      // Every attempt reached the guarded update; only 2 passed the guard.
      expect(prisma.user.updateMany).toHaveBeenCalledTimes(attempts);
      results
        .filter((r) => !r.consumed)
        .forEach((r) => expect(r.remaining).toBe(0));
    });

    it('rejects an unknown user', async () => {
      const { service } = makeService([]);
      await expect(service.consumeTrial('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('acquireVisionUse (atomic access + charge)', () => {
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
      expect(store[0].visionTrialsUsed).toBe(0); // premium never charges
    });

    it('charges a FREE account and allows while trials remain', async () => {
      const { service, store } = makeService([FREE(0)]);
      const first = await service.acquireVisionUse('u1');
      expect(first).toEqual({
        allowed: true,
        isPremium: false,
        remaining: 1,
        reason: 'trial',
        consumedTrial: true,
      });
      const second = await service.acquireVisionUse('u1');
      expect(second.consumedTrial).toBe(true);
      expect(second.remaining).toBe(0);
      expect(store[0].visionTrialsUsed).toBe(2);
    });

    it('blocks a FREE account once trials are exhausted, without charging', async () => {
      const { service, store } = makeService([FREE(2)]);
      const res = await service.acquireVisionUse('u1');
      expect(res).toEqual({
        allowed: false,
        isPremium: false,
        remaining: 0,
        reason: 'exhausted',
        consumedTrial: false,
      });
      expect(store[0].visionTrialsUsed).toBe(2); // unchanged
    });

    it('allows at most the limit worth of trials across concurrent acquires', async () => {
      const { service, store } = makeService([FREE(0)]);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => service.acquireVisionUse('u1')),
      );
      const allowed = results.filter((r) => r.allowed).length;
      expect(allowed).toBe(VISION_TRIAL_LIMIT);
      expect(store[0].visionTrialsUsed).toBe(VISION_TRIAL_LIMIT);
    });
  });
});
