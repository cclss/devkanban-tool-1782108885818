import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FindIdService } from './find-id.service';
import { MESSAGES, SIGNER_VERIFY_MAX_ATTEMPTS } from '../common/messages';

/* Minimal in-memory doubles for the bits of Prisma / Email / Notifications the
 * service touches — mirrors the hand-rolled mock style in auth.service.spec. */

interface MockUser {
  id: string;
  email: string;
  name: string | null;
  phoneNumber: string | null;
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

function makeService(users: MockUser[]) {
  const challenges: MockChallenge[] = [];
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
        if (where.email !== undefined) return users.find((u) => u.email === where.email) ?? null;
        if (where.phoneNumber !== undefined)
          return users.find((u) => u.phoneNumber === where.phoneNumber) ?? null;
        return null;
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
  };

  const config = { get: jest.fn(() => undefined) };

  const service = new FindIdService(
    prisma as any,
    { send: emailSend } as any,
    { enqueue } as any,
    config as any,
  );

  return { service, challenges, emailSend, enqueue };
}

const USER: MockUser = {
  id: 'u1',
  email: 'hong@example.com',
  name: '홍길동',
  phoneNumber: '01012345678',
};

/** Pull the 6-digit code out of the captured code-email text. */
function codeFromEmail(emailSend: jest.Mock): string {
  const msg = emailSend.mock.calls[0][0];
  const match = String(msg.text).match(/\b(\d{6})\b/);
  if (!match) throw new Error('no code in email');
  return match[1];
}

describe('FindIdService.request', () => {
  it('sends a code for a matching email and stores only a hash', async () => {
    const { service, challenges, emailSend } = makeService([USER]);
    const res = await service.request({ channel: 'email', target: 'hong@example.com' } as any);

    expect(res.message).toBe(MESSAGES.findId.requestAccepted);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(challenges).toHaveLength(1);
    const code = codeFromEmail(emailSend);
    // Stored value is a hash, never the plaintext code.
    expect(challenges[0].codeHash).not.toContain(code);
    expect(challenges[0].codeHash).toHaveLength(64);
  });

  it('returns the same generic response and sends nothing for an unknown target', async () => {
    const { service, challenges, emailSend } = makeService([USER]);
    const res = await service.request({ channel: 'email', target: 'nobody@example.com' } as any);

    expect(res.message).toBe(MESSAGES.findId.requestAccepted);
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
    // Capped at the per-window maximum (5), not once per call.
    expect(emailSend).toHaveBeenCalledTimes(5);
  });
});

describe('FindIdService.verify', () => {
  async function requestCode(svc: ReturnType<typeof makeService>) {
    await svc.service.request({ channel: 'email', target: 'hong@example.com' } as any);
    return codeFromEmail(svc.emailSend);
  }

  it('verifies a correct code, returns a masked ID, and delivers the full ID', async () => {
    const svc = makeService([USER]);
    const code = await requestCode(svc);
    svc.emailSend.mockClear();

    const res = await svc.service.verify({
      channel: 'email',
      target: 'hong@example.com',
      code,
    } as any);

    expect(res.message).toBe(MESSAGES.findId.verified);
    expect(res.maskedId).toBe('ho***@example.com');
    // The full ID is delivered out of band (result email), never echoed.
    expect(svc.emailSend).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(res)).not.toContain('hong@example.com');
  });

  it('rejects a wrong code without revealing more, and counts the attempt', async () => {
    const svc = makeService([USER]);
    await requestCode(svc);

    await expect(
      svc.service.verify({ channel: 'email', target: 'hong@example.com', code: '000000' } as any),
    ).rejects.toThrow(MESSAGES.findId.codeMismatch);
    expect(svc.challenges[0].attempts).toBe(1);
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
    ).rejects.toThrow(MESSAGES.findId.codeExpired);
  });

  it('consumes the code so it cannot be reused', async () => {
    const svc = makeService([USER]);
    const code = await requestCode(svc);

    await svc.service.verify({ channel: 'email', target: 'hong@example.com', code } as any);
    await expect(
      svc.service.verify({ channel: 'email', target: 'hong@example.com', code } as any),
    ).rejects.toThrow(MESSAGES.findId.codeMismatch);
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
