import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ResetPasswordService } from './reset-password.service';
import { MESSAGES, SIGNER_VERIFY_MAX_ATTEMPTS } from '../common/messages';

/* In-memory doubles for the bits of Prisma / Email / Notifications the service
 * touches — mirrors the hand-rolled mock style in find-id.service.spec. */

interface MockUser {
  id: string;
  email: string;
  name: string | null;
  phoneNumber: string | null;
  passwordHash: string | null;
}

interface MockChallenge {
  id: string;
  purpose: string;
  channel: string;
  target: string;
  codeHash: string;
  userId: string | null;
  attempts: number;
  consumedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface MockResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  consumedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function makeService(seed: MockUser[]) {
  const users = seed.map((u) => ({ ...u }));
  const challenges: MockChallenge[] = [];
  const tokens: MockResetToken[] = [];
  let seq = 0;
  const emailSend = jest.fn(async (..._args: any[]) => ({ delivered: true }));
  const enqueue = jest.fn(async (..._args: any[]) => undefined);

  const matchTarget = (c: MockChallenge, where: Record<string, unknown>) =>
    c.purpose === where.purpose &&
    c.channel === where.channel &&
    c.target === where.target;

  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: Partial<MockUser> }) => {
        if (where.id !== undefined) return users.find((u) => u.id === where.id) ?? null;
        if (where.email !== undefined) return users.find((u) => u.email === where.email) ?? null;
        if (where.phoneNumber !== undefined)
          return users.find((u) => u.phoneNumber === where.phoneNumber) ?? null;
        return null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const u = users.find((x) => x.id === where.id)!;
        if (data.passwordHash !== undefined) u.passwordHash = data.passwordHash;
        return u;
      }),
    },
    identityVerification: {
      create: jest.fn(async ({ data }: { data: Partial<MockChallenge> }) => {
        const now = new Date();
        const row: MockChallenge = {
          id: `iv_${++seq}`,
          purpose: data.purpose!,
          channel: data.channel!,
          target: data.target!,
          codeHash: data.codeHash!,
          userId: data.userId ?? null,
          attempts: 0,
          consumedAt: null,
          expiresAt: data.expiresAt!,
          createdAt: now,
          updatedAt: now,
        };
        challenges.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const rows = challenges
          .filter((c) => matchTarget(c, where) && c.consumedAt === null)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const row = rows[0];
        if (!row) return null;
        return { ...row, user: users.find((u) => u.id === row.userId) ?? null };
      }),
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        challenges.filter((c) => matchTarget(c, where)).length,
      ),
      aggregate: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ({
        _sum: {
          attempts: challenges
            .filter((c) => matchTarget(c, where))
            .reduce((sum, c) => sum + c.attempts, 0),
        },
      })),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const row = challenges.find((c) => c.id === where.id)!;
        if (data.attempts?.increment) row.attempts += data.attempts.increment;
        row.updatedAt = new Date();
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: any; data: any }) => {
        const row = challenges.find((c) => c.id === where.id && c.consumedAt === null);
        if (!row) return { count: 0 };
        row.consumedAt = data.consumedAt;
        return { count: 1 };
      }),
    },
    passwordResetToken: {
      create: jest.fn(async ({ data }: { data: Partial<MockResetToken> }) => {
        const now = new Date();
        const row: MockResetToken = {
          id: `prt_${++seq}`,
          userId: data.userId!,
          tokenHash: data.tokenHash!,
          consumedAt: null,
          expiresAt: data.expiresAt!,
          createdAt: now,
          updatedAt: now,
        };
        tokens.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const row = tokens
          .filter((t) => t.tokenHash === where.tokenHash && t.consumedAt === null)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        if (!row) return null;
        return { ...row, user: users.find((u) => u.id === row.userId) ?? null };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: any; data: any }) => {
        let count = 0;
        for (const t of tokens) {
          if (t.consumedAt !== null) continue;
          if (where.id !== undefined && t.id !== where.id) continue;
          if (where.userId !== undefined && t.userId !== where.userId) continue;
          t.consumedAt = data.consumedAt;
          count += 1;
        }
        return { count };
      }),
    },
  };

  const config = { get: jest.fn(() => undefined) };

  const service = new ResetPasswordService(
    prisma as any,
    { send: emailSend } as any,
    { enqueue } as any,
    config as any,
  );

  return { service, users, challenges, tokens, emailSend, enqueue };
}

const USER: MockUser = {
  id: 'u1',
  email: 'hong@example.com',
  name: '홍길동',
  phoneNumber: '01012345678',
  passwordHash: '$2a$10$oldoldoldoldoldoldoldoldoldoldoldoldoldoldoldoldoldoldo',
};

/** Pull the 6-digit code out of the captured code-email text. */
function codeFromEmail(emailSend: jest.Mock): string {
  const msg = emailSend.mock.calls[0][0];
  const match = String(msg.text).match(/\b(\d{6})\b/);
  if (!match) throw new Error('no code in email');
  return match[1];
}

describe('ResetPasswordService.request', () => {
  it('sends a code for a matching email and stores only a hash', async () => {
    const { service, challenges, emailSend } = makeService([USER]);
    const res = await service.request({ channel: 'email', target: 'hong@example.com' } as any);

    expect(res.message).toBe(MESSAGES.resetPassword.requestAccepted);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(challenges).toHaveLength(1);
    const code = codeFromEmail(emailSend);
    expect(challenges[0].codeHash).not.toContain(code);
    expect(challenges[0].codeHash).toHaveLength(64);
  });

  it('returns the same generic response and sends nothing for an unknown target', async () => {
    const { service, challenges, emailSend } = makeService([USER]);
    const res = await service.request({ channel: 'email', target: 'nobody@example.com' } as any);

    expect(res.message).toBe(MESSAGES.resetPassword.requestAccepted);
    expect(emailSend).not.toHaveBeenCalled();
    expect(challenges).toHaveLength(0);
  });

  it('uses the alimtalk channel for phone requests', async () => {
    const { service, enqueue } = makeService([USER]);
    await service.request({ channel: 'phone', target: '01012345678' } as any);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({ channel: 'alimtalk', to: '01012345678' });
  });

  it('throttles repeated requests for the same target', async () => {
    const { service, emailSend } = makeService([USER]);
    for (let i = 0; i < 8; i++) {
      await service.request({ channel: 'email', target: 'hong@example.com' } as any);
    }
    expect(emailSend).toHaveBeenCalledTimes(5);
  });
});

describe('ResetPasswordService.verify', () => {
  async function requestCode(svc: ReturnType<typeof makeService>) {
    await svc.service.request({ channel: 'email', target: 'hong@example.com' } as any);
    return codeFromEmail(svc.emailSend);
  }

  it('verifies a correct code and returns a plaintext reset token stored only as a hash', async () => {
    const svc = makeService([USER]);
    const code = await requestCode(svc);

    const res = await svc.service.verify({
      channel: 'email',
      target: 'hong@example.com',
      code,
    } as any);

    expect(res.message).toBe(MESSAGES.resetPassword.verified);
    expect(res.resetToken).toMatch(/^[0-9a-f]{64}$/);
    expect(svc.tokens).toHaveLength(1);
    // Persisted value is a hash, never the plaintext token.
    expect(svc.tokens[0].tokenHash).not.toBe(res.resetToken);
    expect(svc.tokens[0].tokenHash).toHaveLength(64);
  });

  it('rejects a wrong code without revealing more, and counts the attempt', async () => {
    const svc = makeService([USER]);
    await requestCode(svc);

    await expect(
      svc.service.verify({ channel: 'email', target: 'hong@example.com', code: '000000' } as any),
    ).rejects.toThrow(MESSAGES.resetPassword.codeMismatch);
    expect(svc.challenges[0].attempts).toBe(1);
    expect(svc.tokens).toHaveLength(0);
  });

  it('treats an unknown target the same as a wrong code (no enumeration)', async () => {
    const svc = makeService([USER]);
    await expect(
      svc.service.verify({ channel: 'email', target: 'nobody@example.com', code: '123456' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired code', async () => {
    const svc = makeService([USER]);
    const code = await requestCode(svc);
    svc.challenges[0].expiresAt = new Date(Date.now() - 1000);

    await expect(
      svc.service.verify({ channel: 'email', target: 'hong@example.com', code } as any),
    ).rejects.toThrow(MESSAGES.resetPassword.codeExpired);
  });

  it('consumes the code so it cannot be reused', async () => {
    const svc = makeService([USER]);
    const code = await requestCode(svc);

    await svc.service.verify({ channel: 'email', target: 'hong@example.com', code } as any);
    await expect(
      svc.service.verify({ channel: 'email', target: 'hong@example.com', code } as any),
    ).rejects.toThrow(MESSAGES.resetPassword.codeMismatch);
  });

  it('locks out after too many recent failed attempts', async () => {
    const svc = makeService([USER]);
    const code = await requestCode(svc);
    svc.challenges[0].attempts = SIGNER_VERIFY_MAX_ATTEMPTS;

    await expect(
      svc.service.verify({ channel: 'email', target: 'hong@example.com', code } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ResetPasswordService.confirm', () => {
  async function mintToken(svc: ReturnType<typeof makeService>) {
    await svc.service.request({ channel: 'email', target: 'hong@example.com' } as any);
    const code = codeFromEmail(svc.emailSend);
    const { resetToken } = await svc.service.verify({
      channel: 'email',
      target: 'hong@example.com',
      code,
    } as any);
    svc.emailSend.mockClear();
    return resetToken;
  }

  it('sets a new bcrypt-hashed password and consumes the token', async () => {
    const svc = makeService([USER]);
    const token = await mintToken(svc);

    const res = await svc.service.confirm({
      token,
      password: 'newpassword123',
      passwordConfirm: 'newpassword123',
    } as any);

    expect(res.message).toBe(MESSAGES.resetPassword.completed);
    const stored = svc.users[0].passwordHash!;
    // One-way hash: never the plaintext, and verifiable with bcrypt.
    expect(stored).not.toContain('newpassword123');
    expect(await bcrypt.compare('newpassword123', stored)).toBe(true);
    expect(svc.tokens[0].consumedAt).not.toBeNull();
    // Confirmation security notice e-mailed out of band.
    expect(svc.emailSend).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown / invalid token', async () => {
    const svc = makeService([USER]);
    await expect(
      svc.service.confirm({
        token: 'deadbeef',
        password: 'newpassword123',
        passwordConfirm: 'newpassword123',
      } as any),
    ).rejects.toThrow(MESSAGES.resetPassword.tokenInvalid);
  });

  it('rejects an expired token', async () => {
    const svc = makeService([USER]);
    const token = await mintToken(svc);
    svc.tokens[0].expiresAt = new Date(Date.now() - 1000);

    await expect(
      svc.service.confirm({
        token,
        password: 'newpassword123',
        passwordConfirm: 'newpassword123',
      } as any),
    ).rejects.toThrow(MESSAGES.resetPassword.tokenInvalid);
  });

  it('rejects reuse of a token that already set a password', async () => {
    const svc = makeService([USER]);
    const token = await mintToken(svc);

    await svc.service.confirm({
      token,
      password: 'newpassword123',
      passwordConfirm: 'newpassword123',
    } as any);

    await expect(
      svc.service.confirm({
        token,
        password: 'anotherpass456',
        passwordConfirm: 'anotherpass456',
      } as any),
    ).rejects.toThrow(MESSAGES.resetPassword.tokenInvalid);
  });

  it('invalidates other outstanding reset tokens for the same user', async () => {
    const svc = makeService([USER]);
    // First token, left unused.
    const stale = await mintToken(svc);
    // Second token, used to actually reset.
    const fresh = await mintToken(svc);

    await svc.service.confirm({
      token: fresh,
      password: 'newpassword123',
      passwordConfirm: 'newpassword123',
    } as any);

    // The older, still-unused token must no longer work.
    await expect(
      svc.service.confirm({
        token: stale,
        password: 'anotherpass456',
        passwordConfirm: 'anotherpass456',
      } as any),
    ).rejects.toThrow(MESSAGES.resetPassword.tokenInvalid);
  });
});
