import {
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { SharingService } from './sharing.service';
import { ShareSessionService } from './share-session.service';
import { SigningService } from '../signing/signing.service';
import { SendQuotaService } from '../common/send-quota.service';
import { FREE_PLAN_MONTHLY_LIMIT, SHARE_UNLOCK_MAX_ATTEMPTS } from '../common/messages';

/**
 * Integration-style coverage of the link-sharing flow, wiring the REAL
 * SigningService (reused field/submit machinery) and ShareSessionService over a
 * small in-memory Prisma fake. Exercises the happy path
 * (create → unlock → fields → submit → completion enqueued) plus expiry,
 * revocation, wrong/locked password, and the no-secret-leak invariant.
 */

const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const DAY = 24 * 60 * 60 * 1000;

interface Row {
  [k: string]: unknown;
}

/** Minimal in-memory Prisma double covering the queries both services issue. */
function makePrisma() {
  const users = new Map<string, Row>();
  const documents = new Map<string, Row>();
  const signRequests = new Map<string, Row>();
  const signFields: Row[] = [];
  const auditLogs: Row[] = [];
  let seq = 0;
  const id = (p: string) => `${p}_${(seq += 1)}`;

  const enrich = (sr: Row): Row => {
    const document = documents.get(sr.documentId as string)!;
    const owner = users.get(document.ownerId as string)!;
    return {
      ...sr,
      documentId: sr.documentId,
      document: { ...document, owner },
      signFields: signFields.filter((f) => f.signRequestId === sr.id),
    };
  };

  const prisma = {
    // exposed for assertions / seeding
    _users: users,
    _documents: documents,
    _signRequests: signRequests,
    _signFields: signFields,
    _auditLogs: auditLogs,

    user: {
      create: ({ data }: { data: Row }) => {
        const row = { id: id('user'), ...data };
        users.set(row.id, row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: { where: Row }) =>
        Promise.resolve(users.get(where.id as string) ?? null),
    },
    document: {
      create: ({ data }: { data: Row }) => {
        const row = { id: id('doc'), status: 'DRAFT', pageCount: 1, ...data };
        documents.set(row.id, row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: { where: Row }) =>
        Promise.resolve(documents.get(where.id as string) ?? null),
      update: ({ where, data }: { where: Row; data: Row }) => {
        const row = documents.get(where.id as string)!;
        Object.assign(row, data);
        return Promise.resolve(row);
      },
      count: ({ where }: { where: Row }) => {
        const gte = (where.sentAt as Row | undefined)?.gte as Date | undefined;
        const n = [...documents.values()].filter(
          (d) =>
            (where.ownerId === undefined || d.ownerId === where.ownerId) &&
            (gte === undefined ||
              (d.sentAt != null && (d.sentAt as Date).getTime() >= gte.getTime())),
        ).length;
        return Promise.resolve(n);
      },
    },
    signRequest: {
      create: ({ data }: { data: Row }) => {
        const row = {
          id: id('sr'),
          status: 'PENDING',
          accessMode: 'CODE',
          recipientEmail: null,
          recipientName: null,
          linkPasswordHash: null,
          linkExpiresAt: null,
          linkRevokedAt: null,
          linkLabel: null,
          signedAt: null,
          createdAt: new Date(),
          ...data,
        };
        signRequests.set(row.id, row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: { where: Row }) => {
        let sr: Row | undefined;
        if (where.id) sr = signRequests.get(where.id as string);
        else if (where.accessToken)
          sr = [...signRequests.values()].find((r) => r.accessToken === where.accessToken);
        return Promise.resolve(sr ? enrich(sr) : null);
      },
      findMany: ({ where, orderBy }: { where: Row; orderBy?: Row }) => {
        let rows = [...signRequests.values()].filter(
          (r) =>
            (where.documentId === undefined || r.documentId === where.documentId) &&
            (where.accessMode === undefined || r.accessMode === where.accessMode),
        );
        if (orderBy && (orderBy as Row).createdAt === 'desc') {
          rows = rows.sort(
            (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
          );
        }
        return Promise.resolve(rows.map((r) => ({ ...r })));
      },
      update: ({ where, data }: { where: Row; data: Row }) => {
        const row = signRequests.get(where.id as string)!;
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      },
      count: ({ where }: { where: Row }) => {
        const not = (where.status as Row | undefined)?.not;
        const n = [...signRequests.values()].filter(
          (r) =>
            r.documentId === where.documentId && (not === undefined || r.status !== not),
        ).length;
        return Promise.resolve(n);
      },
    },
    signField: {
      findMany: ({ where }: { where: Row }) =>
        Promise.resolve(
          signFields
            .filter((f) => f.signRequestId === where.signRequestId)
            .map((f) => ({ ...f })),
        ),
      updateMany: ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const f of signFields) {
          if (
            f.documentId === where.documentId &&
            (where.signRequestId === null
              ? f.signRequestId === null
              : f.signRequestId === where.signRequestId)
          ) {
            Object.assign(f, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
      update: ({ where, data }: { where: Row; data: Row }) => {
        const f = signFields.find((x) => x.id === where.id)!;
        Object.assign(f, data);
        return Promise.resolve({ ...f });
      },
    },
    auditLog: {
      create: ({ data }: { data: Row }) => {
        const row = { id: id('audit'), createdAt: new Date(), ...data };
        auditLogs.push(row);
        return Promise.resolve(row);
      },
      count: ({ where }: { where: Row }) => {
        const n = auditLogs.filter(
          (l) =>
            l.signRequestId === where.signRequestId &&
            (where.action === undefined || l.action === where.action),
        ).length;
        return Promise.resolve(n);
      },
    },
    $transaction: (arg: unknown) => {
      if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
      return Promise.all(arg as Promise<unknown>[]);
    },
  };
  return prisma;
}

interface Harness {
  sharing: SharingService;
  prisma: ReturnType<typeof makePrisma>;
  completionEnqueue: jest.Mock;
  shareSessions: ShareSessionService;
  ownerId: string;
  documentId: string;
}

function setup(): Harness {
  const prisma = makePrisma();
  const config = { get: () => undefined } as never;
  const shareSessions = new ShareSessionService(new JwtService({}), config);

  const completionEnqueue = jest.fn().mockResolvedValue(undefined);
  const completionQueue = { enqueue: completionEnqueue } as never;
  const storage = {
    openStream: jest.fn().mockResolvedValue({ on: jest.fn(), pipe: jest.fn() }),
  } as never;
  const signerSessions = {} as never;
  const signing = new SigningService(prisma as never, storage, signerSessions, completionQueue);

  const sendQuota = new SendQuotaService(prisma as never);
  const sharing = new SharingService(prisma as never, config, shareSessions, signing, sendQuota);

  // Seed an owner + a DRAFT document with two unassigned fields.
  const owner = { id: 'owner_1', email: 'sender@toss.im', name: '토스' };
  prisma._users.set(owner.id, owner);
  const document = {
    id: 'doc_1',
    ownerId: owner.id,
    title: '용역 계약서',
    status: 'DRAFT',
    pageCount: 1,
    storageKey: 'documents/owner_1/orig.pdf',
  };
  prisma._documents.set(document.id, document);
  prisma._signFields.push(
    { id: 'f1', documentId: document.id, signRequestId: null, type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, value: null },
    { id: 'f2', documentId: document.id, signRequestId: null, type: 'TEXT', page: 1, x: 0.1, y: 0.4, width: 0.3, height: 0.05, value: null },
  );

  return { sharing, prisma, completionEnqueue, shareSessions, ownerId: owner.id, documentId: document.id };
}

describe('SharingService — link creation', () => {
  it('creates a link, hashes the password, and connects unassigned fields', async () => {
    const h = setup();
    const view = await h.sharing.createLink(h.ownerId, h.documentId, {
      password: 'secret12',
      expiresInDays: 3,
      label: '거래처 A',
    });

    expect(view.requiresPassword).toBe(true);
    expect(view.status).toBe('active');
    expect(view.label).toBe('거래처 A');
    expect(view.token).toHaveLength(48);
    expect(view.expiresAt).not.toBeNull();

    // Both unassigned fields were connected to the new LINK request.
    const assigned = h.prisma._signFields.filter((f) => f.signRequestId === view.id);
    expect(assigned).toHaveLength(2);

    // The stored row holds a bcrypt hash (never the plaintext).
    const row = h.prisma._signRequests.get(view.id)!;
    expect(row.linkPasswordHash).toMatch(/^\$2[aby]\$/);
    expect(row.linkPasswordHash).not.toBe('secret12');
    expect(await bcrypt.compare('secret12', row.linkPasswordHash as string)).toBe(true);
  });

  it('never leaks the password or hash in the response or audit metadata', async () => {
    const h = setup();
    const view = await h.sharing.createLink(h.ownerId, h.documentId, { password: 'topsecret' });

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('topsecret');
    expect(serialized).not.toContain('$2');
    expect(view).not.toHaveProperty('password');
    expect(view).not.toHaveProperty('linkPasswordHash');

    const created = h.prisma._auditLogs.find((l) => l.action === 'SHARE_LINK_CREATED')!;
    expect(JSON.stringify(created.metadata)).not.toContain('topsecret');
    expect((created.metadata as Row).hasPassword).toBe(true);
  });

  it('defaults to no password and a one-week expiry; honours "no expiry"', async () => {
    const h = setup();
    const withDefault = await h.sharing.createLink(h.ownerId, h.documentId, {});
    expect(withDefault.requiresPassword).toBe(false);
    const ms = new Date(withDefault.expiresAt as string).getTime() - Date.now();
    expect(ms).toBeGreaterThan(6.5 * DAY);
    expect(ms).toBeLessThan(7.5 * DAY);

    const forever = await h.sharing.createLink(h.ownerId, h.documentId, { noExpiry: true });
    expect(forever.expiresAt).toBeNull();
  });

  it('rejects a document the caller does not own', async () => {
    const h = setup();
    await expect(h.sharing.createLink('intruder', h.documentId, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(h.sharing.createLink(h.ownerId, 'nope', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('dispatches the DRAFT contract on the first link (진행 중 + sentAt), idempotently', async () => {
    const h = setup();
    const doc = h.prisma._documents.get(h.documentId)!;
    expect(doc.status).toBe('DRAFT');

    await h.sharing.createLink(h.ownerId, h.documentId, {});
    // DRAFT → 진행 중 with a sentAt stamp so the dashboard + quota see a dispatch.
    expect(doc.status).toBe('IN_PROGRESS');
    expect(doc.sentAt).toBeInstanceOf(Date);

    const stampedAt = doc.sentAt;
    // A second link on the already-dispatched document leaves status/sentAt alone.
    await h.sharing.createLink(h.ownerId, h.documentId, {});
    expect(doc.status).toBe('IN_PROGRESS');
    expect(doc.sentAt).toBe(stampedAt);
  });

  it('rejects the first link once the Free-plan monthly limit is used up', async () => {
    const h = setup();
    // Fill this month's allowance with already-dispatched documents.
    for (let i = 0; i < FREE_PLAN_MONTHLY_LIMIT; i += 1) {
      h.prisma._documents.set(`sent_${i}`, {
        id: `sent_${i}`,
        ownerId: h.ownerId,
        title: `보낸 계약 ${i}`,
        status: 'IN_PROGRESS',
        sentAt: new Date(),
      });
    }

    await expect(h.sharing.createLink(h.ownerId, h.documentId, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // The DRAFT document is untouched — no partial dispatch on rejection.
    expect(h.prisma._documents.get(h.documentId)!.status).toBe('DRAFT');
  });
});

describe('SharingService — pre-auth meta', () => {
  it('returns minimal metadata without PDF or fields', async () => {
    const h = setup();
    const link = await h.sharing.createLink(h.ownerId, h.documentId, { password: 'secret12' });
    const meta = await h.sharing.meta(link.token);

    expect(meta.documentTitle).toBe('용역 계약서');
    expect(meta.requiresPassword).toBe(true);
    expect(meta.sender.name).toBe('토스');
    expect(meta).not.toHaveProperty('fields');
    expect(meta).not.toHaveProperty('pdfPath');
  });

  it('maps expired / revoked / invalid to the right status code', async () => {
    const h = setup();
    const link = await h.sharing.createLink(h.ownerId, h.documentId, {});

    // Expired.
    const row = h.prisma._signRequests.get(link.id)!;
    row.linkExpiresAt = new Date(Date.now() - DAY);
    await expect(h.sharing.meta(link.token)).rejects.toBeInstanceOf(GoneException);

    // Revoked wins over expiry.
    row.linkRevokedAt = new Date();
    await expect(h.sharing.meta(link.token)).rejects.toBeInstanceOf(ForbiddenException);

    // Unknown token.
    await expect(h.sharing.meta('deadbeef')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SharingService — unlock', () => {
  it('issues a session immediately when no password is set', async () => {
    const h = setup();
    const link = await h.sharing.createLink(h.ownerId, h.documentId, {});
    const { sessionToken } = await h.sharing.unlock(link.token, undefined);

    expect(h.shareSessions.verify(sessionToken).signRequestId).toBe(link.id);
    expect(h.prisma._signRequests.get(link.id)!.status).toBe('VIEWED');
  });

  it('verifies a correct password and rejects a wrong one with 401 + audit', async () => {
    const h = setup();
    const link = await h.sharing.createLink(h.ownerId, h.documentId, { password: 'secret12' });

    await expect(h.sharing.unlock(link.token, 'wrong-pass')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(h.prisma._auditLogs.some((l) => l.action === 'SHARE_UNLOCK_FAILED')).toBe(true);

    const { sessionToken } = await h.sharing.unlock(link.token, 'secret12');
    expect(h.shareSessions.verify(sessionToken).signRequestId).toBe(link.id);
  });

  it('requires a password when one is set but none is supplied', async () => {
    const h = setup();
    const link = await h.sharing.createLink(h.ownerId, h.documentId, { password: 'secret12' });
    await expect(h.sharing.unlock(link.token, undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('locks after too many failures and denies even a correct password', async () => {
    const h = setup();
    const link = await h.sharing.createLink(h.ownerId, h.documentId, { password: 'secret12' });
    for (let i = 0; i < SHARE_UNLOCK_MAX_ATTEMPTS; i += 1) {
      await expect(h.sharing.unlock(link.token, 'wrong')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    await expect(h.sharing.unlock(link.token, 'secret12')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses to unlock an expired or revoked link', async () => {
    const h = setup();
    const link = await h.sharing.createLink(h.ownerId, h.documentId, {});
    const row = h.prisma._signRequests.get(link.id)!;
    row.linkExpiresAt = new Date(Date.now() - DAY);
    await expect(h.sharing.unlock(link.token, undefined)).rejects.toBeInstanceOf(GoneException);

    row.linkExpiresAt = null;
    row.linkRevokedAt = new Date();
    await expect(h.sharing.unlock(link.token, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('SharingService — fill & submit (reuses the completion machine)', () => {
  it('runs create → unlock → payload → fields → submit and enqueues completion', async () => {
    const h = setup();
    const link = await h.sharing.createLink(h.ownerId, h.documentId, {});
    const { sessionToken } = await h.sharing.unlock(link.token, undefined);
    const signRequestId = h.shareSessions.verify(sessionToken).signRequestId;

    const payload = await h.sharing.payload(signRequestId, link.token);
    expect(payload.pdfPath).toBe(`/api/share/${link.token}/pdf`);
    expect(payload.fields).toHaveLength(2);
    expect(payload.fields.every((f) => !f.filled)).toBe(true);

    await h.sharing.saveFields(signRequestId, {
      fields: [
        { fieldId: 'f1', value: PNG_1x1 },
        { fieldId: 'f2', value: '홍길동' },
      ],
    });

    const result = await h.sharing.submit(signRequestId, '203.0.113.5', 'jest');
    expect(result.status).toBe('SIGNED');
    expect(result.documentCompleted).toBe(true);
    expect(result.message).toBe('제출이 완료되었습니다!');

    // The document flipped to COMPLETED and completion post-processing (which
    // notifies the sender) was enqueued exactly once.
    expect(h.prisma._documents.get(h.documentId)!.status).toBe('COMPLETED');
    expect(h.completionEnqueue).toHaveBeenCalledTimes(1);
    expect(h.completionEnqueue).toHaveBeenCalledWith(h.documentId);
  });

  it('blocks submit with unfilled fields and treats a submitted link as done', async () => {
    const h = setup();
    const link = await h.sharing.createLink(h.ownerId, h.documentId, {});
    const { sessionToken } = await h.sharing.unlock(link.token, undefined);
    const signRequestId = h.shareSessions.verify(sessionToken).signRequestId;

    // Nothing filled yet → incomplete.
    await expect(h.sharing.submit(signRequestId)).rejects.toBeInstanceOf(Error);

    // Fill + submit, then a second access is reported as already submitted.
    await h.sharing.saveFields(signRequestId, {
      fields: [
        { fieldId: 'f1', value: PNG_1x1 },
        { fieldId: 'f2', value: '홍길동' },
      ],
    });
    await h.sharing.submit(signRequestId);
    await expect(h.sharing.payload(signRequestId, link.token)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('SharingService — revoke', () => {
  it('revokes idempotently and writes a single audit entry', async () => {
    const h = setup();
    const link = await h.sharing.createLink(h.ownerId, h.documentId, {});

    const revoked = await h.sharing.revokeLink(h.ownerId, h.documentId, link.id);
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).not.toBeNull();

    await h.sharing.revokeLink(h.ownerId, h.documentId, link.id);
    expect(h.prisma._auditLogs.filter((l) => l.action === 'SHARE_LINK_REVOKED')).toHaveLength(1);
  });

  it('rejects revoking a link on a document the caller does not own', async () => {
    const h = setup();
    const link = await h.sharing.createLink(h.ownerId, h.documentId, {});
    await expect(
      h.sharing.revokeLink('intruder', h.documentId, link.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
