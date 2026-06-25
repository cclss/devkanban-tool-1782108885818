import { PDFDocument } from 'pdf-lib';
import { CompletionService } from './completion.service';
import { SignedPdfService } from '../pdf/signed-pdf.service';
import { AuditCertificateService } from '../pdf/audit-certificate.service';
import type { EmailMessage, EmailService } from '../email/email.service';

/** A tiny but valid 1×1 PNG, used as the captured signature value. */
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function makePdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return Buffer.from(await doc.save());
}

/** Build a queryable document fixture with one filled signature field. */
function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc_xyz789',
    ownerId: 'user_1',
    title: '용역 위탁 계약서',
    pageCount: 1,
    storageKey: 'documents/user_1/original.pdf',
    status: 'COMPLETED',
    sentAt: new Date('2026-06-20T01:00:00.000Z'),
    completedAt: null as Date | null,
    owner: { name: '주식회사 토스', email: 'sender@toss.im', brandColor: null, brandLogoUrl: null },
    signRequests: [
      {
        id: 'sr_1',
        recipientEmail: 'signer@example.com',
        recipientName: '홍길동',
        order: 0,
        signedAt: new Date('2026-06-23T08:30:00.000Z'),
        signFields: [
          { type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, value: PNG_1x1 },
        ],
      },
    ],
    auditLogs: [
      { action: 'DOCUMENT_UPLOADED', createdAt: new Date('2026-06-19T23:00:00.000Z'), signRequestId: null, actorId: 'user_1', ipAddress: '203.0.113.7' },
      { action: 'CONTRACT_SENT', createdAt: new Date('2026-06-20T01:00:00.000Z'), signRequestId: null, actorId: 'user_1', ipAddress: '203.0.113.7' },
      { action: 'SIGN_REQUEST_SIGNED', createdAt: new Date('2026-06-23T08:30:00.000Z'), signRequestId: 'sr_1', actorId: null, ipAddress: '198.51.100.23' },
      { action: 'DOCUMENT_COMPLETED', createdAt: new Date('2026-06-23T08:30:05.000Z'), signRequestId: null, actorId: null, ipAddress: null },
    ],
    ...overrides,
  };
}

interface Harness {
  service: CompletionService;
  storage: Map<string, Buffer>;
  emails: EmailMessage[];
  updateManyCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  doc: ReturnType<typeof makeDocument>;
}

function makeHarness(docOverrides: Record<string, unknown> = {}): Harness {
  const storage = new Map<string, Buffer>();
  const emails: EmailMessage[] = [];
  const updateManyCalls: Harness['updateManyCalls'] = [];
  const doc = makeDocument(docOverrides);

  const prisma = {
    document: {
      findUnique: jest.fn(async () => doc),
      updateMany: jest.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updateManyCalls.push(args);
        // Mirror the DB guard: only "apply" when completedAt is still null.
        if (doc.completedAt == null) {
          Object.assign(doc, args.data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
  };

  const storageService = {
    read: jest.fn(async (key: string) => {
      const bytes = storage.get(key);
      if (!bytes) throw new Error(`missing key ${key}`);
      return bytes;
    }),
    save: jest.fn(async (key: string, data: Buffer) => {
      storage.set(key, data);
    }),
  };

  const email: Pick<EmailService, 'sendEach'> = {
    sendEach: jest.fn(async (messages: EmailMessage[]) => {
      emails.push(...messages);
      return messages.map((m) => ({
        delivered: false as const,
        channel: 'console' as const,
        recipients: m.to.map((t) => t.email),
      }));
    }),
  };

  const config = { get: jest.fn(() => undefined) };

  const service = new CompletionService(
    prisma as never,
    storageService as never,
    new SignedPdfService(),
    new AuditCertificateService(),
    email as never,
    config as never,
  );

  return { service, storage, emails, updateManyCalls, doc };
}

describe('CompletionService.runPostProcessing', () => {
  it('generates, stores, emails, and records the completion artifacts', async () => {
    const h = makeHarness();
    h.storage.set('documents/user_1/original.pdf', await makePdf(1));

    const result = await h.service.runPostProcessing('doc_xyz789');

    expect(result.processed).toBe(true);
    expect(result.skipped).toBe(false);

    // Two new artifact objects stored under deterministic keys.
    const signedKey = 'documents/user_1/completed/doc_xyz789-signed.pdf';
    const certKey = 'documents/user_1/completed/doc_xyz789-certificate.pdf';
    expect(h.storage.has(signedKey)).toBe(true);
    expect(h.storage.has(certKey)).toBe(true);
    expect(result.signedStorageKey).toBe(signedKey);
    expect(result.certificateStorageKey).toBe(certKey);

    // Both artifacts are valid, non-trivial PDFs.
    const signed = await PDFDocument.load(h.storage.get(signedKey)!);
    expect(signed.getPageCount()).toBe(1);
    const cert = await PDFDocument.load(h.storage.get(certKey)!);
    expect(cert.getTitle()).toBe('감사 추적 인증서');

    // Sender + one signer emailed, each with both attachments.
    expect(h.emails).toHaveLength(2);
    expect(h.emails.map((m) => m.to[0].email).sort()).toEqual(
      ['sender@toss.im', 'signer@example.com'],
    );
    for (const m of h.emails) {
      expect(m.attachments).toHaveLength(2);
      expect(m.attachments!.every((a) => a.content.length > 0)).toBe(true);
    }
    expect(result.recipientCount).toBe(2);

    // Document recorded with keys + completion time (guarded on completedAt:null).
    expect(h.updateManyCalls).toHaveLength(1);
    expect(h.updateManyCalls[0].where).toMatchObject({ id: 'doc_xyz789', completedAt: null });
    expect(h.updateManyCalls[0].data).toMatchObject({
      signedStorageKey: signedKey,
      certificateStorageKey: certKey,
    });
    expect(h.updateManyCalls[0].data.completedAt).toBeInstanceOf(Date);
  });

  it('is idempotent — a second run on a processed document is a no-op', async () => {
    const h = makeHarness({ completedAt: new Date('2026-06-23T08:30:10.000Z') });
    h.storage.set('documents/user_1/original.pdf', await makePdf(1));

    const result = await h.service.runPostProcessing('doc_xyz789');

    expect(result.skipped).toBe(true);
    expect(result.processed).toBe(false);
    expect(h.emails).toHaveLength(0);
    expect(h.updateManyCalls).toHaveLength(0);
  });

  it('skips a document that is not COMPLETED', async () => {
    const h = makeHarness({ status: 'IN_PROGRESS' });
    h.storage.set('documents/user_1/original.pdf', await makePdf(1));

    const result = await h.service.runPostProcessing('doc_xyz789');

    expect(result.skipped).toBe(true);
    expect(h.emails).toHaveLength(0);
  });

  it('skips a missing document', async () => {
    const h = makeHarness();
    const prisma = (h.service as unknown as { prisma: { document: { findUnique: jest.Mock } } }).prisma;
    prisma.document.findUnique.mockResolvedValueOnce(null);

    const result = await h.service.runPostProcessing('nope');
    expect(result.skipped).toBe(true);
    expect(result.processed).toBe(false);
  });

  it('still completes when the sender is also a signer (one copy each address)', async () => {
    const h = makeHarness({
      signRequests: [
        {
          id: 'sr_1',
          recipientEmail: 'sender@toss.im', // same as owner
          recipientName: '주식회사 토스',
          order: 0,
          signedAt: new Date('2026-06-23T08:30:00.000Z'),
          signFields: [
            { type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, value: PNG_1x1 },
          ],
        },
      ],
    });
    h.storage.set('documents/user_1/original.pdf', await makePdf(1));

    const result = await h.service.runPostProcessing('doc_xyz789');
    expect(result.processed).toBe(true);
    // De-duplicated by address → a single message.
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to[0].email).toBe('sender@toss.im');
  });
});
