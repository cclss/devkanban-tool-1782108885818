import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { MESSAGES } from '../common/messages';

// Mock google-auth-library so no real network/token exchange happens. Each test
// configures `getToken` / `verifyIdToken` behavior via these jest fns.
const getToken = jest.fn();
const verifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ getToken, verifyIdToken })),
}));

type MockUser = {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  googleId: string | null;
};

function makeService(opts: {
  config?: Record<string, string | undefined>;
  users?: MockUser[];
}) {
  const config = opts.config ?? {
    GOOGLE_CLIENT_ID: 'client-id-123',
    GOOGLE_CLIENT_SECRET: 'secret',
  };
  const store = [...(opts.users ?? [])];

  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: Partial<MockUser> }) => {
        if (where.googleId !== undefined) {
          return store.find((u) => u.googleId === where.googleId) ?? null;
        }
        if (where.email !== undefined) {
          return store.find((u) => u.email === where.email) ?? null;
        }
        return store.find((u) => u.id === where.id) ?? null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<MockUser> }) => {
        const u = store.find((x) => x.id === where.id)!;
        Object.assign(u, data);
        return u;
      }),
      create: jest.fn(async ({ data }: { data: Partial<MockUser> }) => {
        const u: MockUser = {
          id: `user_${store.length + 1}`,
          email: data.email!,
          name: data.name ?? null,
          plan: 'FREE',
          googleId: data.googleId ?? null,
        };
        store.push(u);
        return u;
      }),
    },
  };

  const jwt = { sign: jest.fn(() => 'signed.jwt.token') };
  const configService = { get: jest.fn((k: string) => config[k]) };

  const service = new AuthService(
    prisma as never,
    jwt as never,
    configService as never,
  );
  return { service, prisma, store };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'google-sub-1',
    email: 'New@Example.com',
    email_verified: true,
    name: '홍길동',
    ...overrides,
  };
}

beforeEach(() => {
  getToken.mockReset();
  verifyIdToken.mockReset();
});

describe('AuthService.loginWithGoogle', () => {
  it('creates a new account (googleId + normalized email) for a first-time Google user', async () => {
    const { service, store } = makeService({ users: [] });
    getToken.mockResolvedValue({ tokens: { id_token: 'id.token' } });
    verifyIdToken.mockResolvedValue({ getPayload: () => payload() });

    const result = await service.loginWithGoogle({ code: 'auth-code' });

    expect(result).toEqual({
      accessToken: 'signed.jwt.token',
      user: { id: 'user_1', email: 'new@example.com', name: '홍길동', plan: 'FREE' },
    });
    expect(store[0].googleId).toBe('google-sub-1');
    expect(store[0].email).toBe('new@example.com');
    // Audience check is enforced against the configured client id.
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'id.token',
      audience: 'client-id-123',
    });
  });

  it('links googleId to an existing email-matched account', async () => {
    const existing: MockUser = {
      id: 'user_99',
      email: 'new@example.com',
      name: '기존',
      plan: 'PRO',
      googleId: null,
    };
    const { service, store } = makeService({ users: [existing] });
    getToken.mockResolvedValue({ tokens: { id_token: 'id.token' } });
    verifyIdToken.mockResolvedValue({ getPayload: () => payload() });

    const result = await service.loginWithGoogle({ code: 'auth-code' });

    expect(store).toHaveLength(1);
    expect(store[0].googleId).toBe('google-sub-1');
    expect(result.user).toEqual({ id: 'user_99', email: 'new@example.com', name: '기존', plan: 'PRO' });
  });

  it('logs in an already-linked Google account without creating a duplicate', async () => {
    const linked: MockUser = {
      id: 'user_7',
      email: 'new@example.com',
      name: '홍길동',
      plan: 'FREE',
      googleId: 'google-sub-1',
    };
    const { service, store, prisma } = makeService({ users: [linked] });
    getToken.mockResolvedValue({ tokens: { id_token: 'id.token' } });
    verifyIdToken.mockResolvedValue({ getPayload: () => payload() });

    const result = await service.loginWithGoogle({ code: 'auth-code' });

    expect(store).toHaveLength(1);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(result.user.id).toBe('user_7');
  });

  it('rejects an invalid/expired code (token exchange failure) with 401 + tone copy', async () => {
    const { service } = makeService({ users: [] });
    getToken.mockRejectedValue(new Error('invalid_grant'));

    const err = await service.loginWithGoogle({ code: 'bad' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as Error).message).toBe(MESSAGES.auth.googleAuthFailed);
  });

  it('rejects when id_token signature/audience verification fails', async () => {
    const { service } = makeService({ users: [] });
    getToken.mockResolvedValue({ tokens: { id_token: 'id.token' } });
    verifyIdToken.mockRejectedValue(new Error('Wrong recipient'));

    await expect(service.loginWithGoogle({ code: 'auth-code' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an unverified Google email with its own copy', async () => {
    const { service } = makeService({ users: [] });
    getToken.mockResolvedValue({ tokens: { id_token: 'id.token' } });
    verifyIdToken.mockResolvedValue({ getPayload: () => payload({ email_verified: false }) });

    await expect(service.loginWithGoogle({ code: 'auth-code' })).rejects.toMatchObject({
      message: MESSAGES.auth.googleEmailUnverified,
    });
  });

  it('fails safe with 503 when Google credentials are not configured', async () => {
    const { service } = makeService({ config: {}, users: [] });

    await expect(service.loginWithGoogle({ code: 'auth-code' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(getToken).not.toHaveBeenCalled();
  });
});
