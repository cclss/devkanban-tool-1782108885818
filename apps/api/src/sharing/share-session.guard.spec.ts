import {
  ExecutionContext,
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ShareSessionGuard } from './share-session.guard';
import { ShareSessionService } from './share-session.service';

const DAY = 24 * 60 * 60 * 1000;

function context(token: string, authorization?: string): ExecutionContext {
  const req = { params: { token }, headers: { authorization } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeGuard(link: Record<string, unknown> | null) {
  const sessions = new ShareSessionService(new JwtService({}), { get: () => undefined } as never);
  const prisma = { signRequest: { findUnique: jest.fn().mockResolvedValue(link) } } as never;
  return { guard: new ShareSessionGuard(sessions, prisma), sessions };
}

const activeLink = {
  id: 'sr_1',
  accessMode: 'LINK',
  status: 'VIEWED',
  linkExpiresAt: null,
  linkRevokedAt: null,
};

describe('ShareSessionGuard', () => {
  it('admits a valid session bound to the addressed link', async () => {
    const { guard, sessions } = makeGuard(activeLink);
    const token = sessions.issue('sr_1');
    const ctx = context('tok', `Bearer ${token}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects a missing/!LINK link as 404', async () => {
    const { guard, sessions } = makeGuard(null);
    const ctx = context('tok', `Bearer ${sessions.issue('sr_1')}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enforces expiry (410) and revocation (403) on the session path', async () => {
    const expired = makeGuard({ ...activeLink, linkExpiresAt: new Date(Date.now() - DAY) });
    await expect(
      expired.guard.canActivate(context('tok', `Bearer ${expired.sessions.issue('sr_1')}`)),
    ).rejects.toBeInstanceOf(GoneException);

    const revoked = makeGuard({ ...activeLink, linkRevokedAt: new Date() });
    await expect(
      revoked.guard.canActivate(context('tok', `Bearer ${revoked.sessions.issue('sr_1')}`)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a session bound to a different link, and a missing token', async () => {
    const { guard, sessions } = makeGuard(activeLink);
    await expect(
      guard.canActivate(context('tok', `Bearer ${sessions.issue('other_sr')}`)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(context('tok'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
