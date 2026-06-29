import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Plan } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGES } from '../common/messages';
import { BrandingGuard } from './branding.guard';

function makeContext(user: unknown): ExecutionContext {
  const req = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeGuard(plan: Plan | null): BrandingGuard {
  const prisma = {
    user: {
      findUnique: jest.fn(async () => (plan === null ? null : { plan })),
    },
  } as unknown as PrismaService;
  return new BrandingGuard(prisma);
}

describe('BrandingGuard', () => {
  it('allows TEAM and ENTERPRISE', async () => {
    for (const plan of [Plan.TEAM, Plan.ENTERPRISE]) {
      const guard = makeGuard(plan);
      await expect(
        guard.canActivate(makeContext({ id: 'u', email: 'a@b.c' })),
      ).resolves.toBe(true);
    }
  });

  it('denies FREE and PRO with a 403 Toss-tone message', async () => {
    for (const plan of [Plan.FREE, Plan.PRO]) {
      const guard = makeGuard(plan);
      await expect(
        guard.canActivate(makeContext({ id: 'u', email: 'a@b.c' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        guard.canActivate(makeContext({ id: 'u', email: 'a@b.c' })),
      ).rejects.toThrow(MESSAGES.branding.forbidden);
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    const guard = makeGuard(Plan.TEAM);
    await expect(guard.canActivate(makeContext(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('denies when the user no longer exists', async () => {
    const guard = makeGuard(null);
    await expect(
      guard.canActivate(makeContext({ id: 'gone', email: 'a@b.c' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
