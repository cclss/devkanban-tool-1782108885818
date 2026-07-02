import { DocumentsService } from './documents.service';
import type { ClauseExtractionQueue } from '../clauses/clause-extraction.queue';

/**
 * grain-4: `DocumentsService.send()` enqueues send-time clause pre-generation
 * after the transaction commits, and a queueing failure must not break the send
 * response.
 */
function makeHarness(queueOverrides: Partial<ClauseExtractionQueue> = {}) {
  const document = {
    id: 'doc_1',
    ownerId: 'user_1',
    title: '용역 계약서',
    storageKey: 'documents/user_1/original.pdf',
    pageCount: 1,
    status: 'DRAFT',
    sentAt: null as Date | null,
    completedAt: null as Date | null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    signedStorageKey: null,
    certificateStorageKey: null,
  };

  const db = {
    document: {
      findUnique: jest.fn(async () => document),
      count: jest.fn(async () => 0),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        ...document,
        ...args.data,
      })),
    },
    signField: {
      count: jest.fn(async () => 1),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    signRequest: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'sr_1',
        ...args.data,
      })),
    },
    auditLog: { create: jest.fn(async () => ({})) },
    user: { findUnique: jest.fn(async () => ({ plan: 'FREE' })) },
    // Interactive transaction reuses the same mock as both prisma and tx
    // (assigned below to avoid a self-referential initializer).
    $transaction: jest.fn(),
  };
  // The interactive transaction runs its callback against the same mock.
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));

  const enqueue = jest.fn(async () => undefined);
  const clauseQueue = { enqueue, ...queueOverrides } as unknown as ClauseExtractionQueue;

  const notifications = { enqueueMany: jest.fn(async () => undefined) };
  const config = { get: jest.fn(() => undefined) };
  const storage = {};

  const service = new DocumentsService(
    db as never,
    storage as never,
    notifications as never,
    config as never,
    clauseQueue,
  );

  return { service, enqueue, notifications };
}

const DTO = { recipients: [{ email: 'Signer@Example.com', name: '홍길동' }] };

describe('DocumentsService.send — clause pre-generation enqueue (grain-4)', () => {
  it('enqueues clause extraction with the document id after the send commits', async () => {
    const h = makeHarness();

    const summary = await h.service.send('user_1', 'doc_1', DTO as never);

    expect(summary.status).toBe('IN_PROGRESS');
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.enqueue).toHaveBeenCalledWith('doc_1');
    // Notifications still fire — the main send flow is unchanged.
    expect(h.notifications.enqueueMany).toHaveBeenCalledTimes(1);
  });

  it('still returns a successful send response when enqueue rejects', async () => {
    const enqueue = jest.fn(async () => {
      throw new Error('redis unreachable');
    });
    const h = makeHarness({ enqueue } as never);

    const summary = await h.service.send('user_1', 'doc_1', DTO as never);

    expect(summary.status).toBe('IN_PROGRESS');
    expect(enqueue).toHaveBeenCalledWith('doc_1');
  });
});
