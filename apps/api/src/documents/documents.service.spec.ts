import { DocumentStatus } from '@repo/db';
import { PDFDocument } from 'pdf-lib';
import { DocumentsService } from './documents.service';

/**
 * Unit tests for `uploadAndCreate`'s filename normalization (grain-1 logic).
 *
 * Multer decodes multipart field values — the file name included — as latin1, so
 * a UTF-8 name (한글·이모지 등) arrives as mojibake: each original UTF-8 byte
 * becomes one latin1 code point. `simulateMulterName` reproduces exactly that
 * corruption (utf8 bytes read back as latin1) so these tests exercise the real
 * decode path a browser upload would hit. The assertions pin the user-facing
 * title output rules recorded in `design-spec/vocabulary/document-title.md`:
 * non-ASCII originals are preserved, and plain ASCII names are untouched.
 *
 * The four cases below map 1:1 onto that spec's 결정 1 판정표 (conditional
 * re-decode), so every branch of the normalization — including the two that
 * must be left ALONE to avoid double-encoding — is pinned against regression:
 *   1. mojibake, valid UTF-8 round-trip  → re-decoded  (Korean, emoji)
 *   2. pure ASCII                        → untouched   (standard_contract)
 *   3. already real Unicode (cp > 0xFF)  → untouched   (no double-encode)
 *   4. genuine latin1 (high byte, not valid UTF-8) → untouched (café)
 */

/** Reproduce how Multer surfaces a UTF-8 file name: its bytes read as latin1. */
function simulateMulterName(utf8Name: string): string {
  return Buffer.from(utf8Name, 'utf8').toString('latin1');
}

describe('DocumentsService.uploadAndCreate — filename title normalization', () => {
  let service: DocumentsService;
  let prisma: {
    document: { create: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let storage: { buildKey: jest.Mock; save: jest.Mock };
  let notifications: { enqueueMany: jest.Mock };
  let config: { get: jest.Mock };
  let sendQuota: { assertWithinQuota: jest.Mock; quota: jest.Mock };
  let scheduledSendQueue: { add: jest.Mock; replace: jest.Mock; remove: jest.Mock };

  /** A real, pdf-lib-loadable one-page PDF (magic bytes + valid structure). */
  let pdfBuffer: Buffer;

  beforeAll(async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    pdfBuffer = Buffer.from(await doc.save());
  });

  beforeEach(() => {
    prisma = {
      // Echo the persisted `data` back as a full Document row so `toSummary`
      // can shape a summary. `title` is what we assert on.
      document: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'doc-1',
          ownerId: data.ownerId,
          title: data.title,
          storageKey: data.storageKey,
          pageCount: data.pageCount,
          status: DocumentStatus.DRAFT,
          sentAt: null,
          createdAt: new Date('2026-07-07T00:00:00.000Z'),
          completedAt: null,
          signedStorageKey: null,
          certificateStorageKey: null,
        })),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    // Return the (already-normalized) name back so we can assert the storage key
    // was built from the corrected filename, not the raw mojibake.
    storage = {
      buildKey: jest.fn((ownerId: string, name: string) => `${ownerId}/${name}`),
      save: jest.fn(async () => undefined),
    };
    notifications = { enqueueMany: jest.fn(async () => undefined) };
    config = { get: jest.fn(() => undefined) };
    sendQuota = {
      assertWithinQuota: jest.fn(async () => undefined),
      quota: jest.fn(),
    };
    scheduledSendQueue = {
      add: jest.fn(async () => undefined),
      replace: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };

    service = new DocumentsService(
      prisma as never,
      storage as never,
      notifications as never,
      config as never,
      sendQuota as never,
      scheduledSendQueue as never,
    );
  });

  /** Build the Multer-shaped file object the controller hands to the service. */
  function fileWith(originalname: string) {
    return {
      originalname,
      mimetype: 'application/pdf',
      buffer: pdfBuffer,
      size: pdfBuffer.length,
    };
  }

  it('recovers a Korean filename mangled by latin1 decoding → title "계약서"', async () => {
    const mojibake = simulateMulterName('계약서.pdf');
    // Sanity: the input really is corrupted (not already the clean name).
    expect(mojibake).not.toBe('계약서.pdf');

    const result = await service.uploadAndCreate('owner-1', fileWith(mojibake));

    expect(result.title).toBe('계약서');
    // The corrected name — not the mojibake — flows into the storage key.
    expect(storage.buildKey).toHaveBeenCalledWith('owner-1', '계약서.pdf');
    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: '계약서' }) }),
    );
  });

  it('recovers an emoji filename mangled by latin1 decoding → title "📄✨ summary"', async () => {
    const mojibake = simulateMulterName('📄✨ summary.pdf');
    expect(mojibake).not.toBe('📄✨ summary.pdf');

    const result = await service.uploadAndCreate('owner-1', fileWith(mojibake));

    expect(result.title).toBe('📄✨ summary');
    expect(storage.buildKey).toHaveBeenCalledWith('owner-1', '📄✨ summary.pdf');
  });

  it('leaves a plain ASCII filename untouched → title "standard_contract" (no regression)', async () => {
    const name = 'standard_contract.pdf';
    // Pure ASCII: the Multer decode is a no-op, so the name is unchanged.
    expect(simulateMulterName(name)).toBe(name);

    const result = await service.uploadAndCreate('owner-1', fileWith(name));

    expect(result.title).toBe('standard_contract');
    expect(storage.buildKey).toHaveBeenCalledWith('owner-1', 'standard_contract.pdf');
  });

  it('does NOT double-encode an already-correct Unicode filename → title "계약서"', async () => {
    // Some clients deliver the name already decoded as real UTF-8 (code points
    // > 0xFF). Re-encoding that would corrupt it, so normalization must leave it
    // untouched. Passing the clean name directly (no `simulateMulterName`)
    // models that path.
    const name = '계약서.pdf';
    // Guard the premise: this holds real Unicode, not latin1 mojibake.
    expect(name.codePointAt(0)).toBeGreaterThan(0xff);

    const result = await service.uploadAndCreate('owner-1', fileWith(name));

    expect(result.title).toBe('계약서');
    expect(storage.buildKey).toHaveBeenCalledWith('owner-1', '계약서.pdf');
    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: '계약서' }) }),
    );
  });

  it('preserves a genuine latin1 filename whose bytes are not valid UTF-8 → title "café"', async () => {
    // `é` here is a single latin1 code point (U+00E9), i.e. what a real latin1
    // name looks like after Multer's decode. Its byte (0xE9) is not a valid
    // standalone UTF-8 sequence, so the round-trip check fails and the original
    // name is kept — re-decoding only happens when it provably restores mojibake.
    const name = 'café.pdf';
    expect(name.charCodeAt(3)).toBe(0xe9); // premise: high byte, ≤ 0xFF

    const result = await service.uploadAndCreate('owner-1', fileWith(name));

    expect(result.title).toBe('café');
    expect(storage.buildKey).toHaveBeenCalledWith('owner-1', 'café.pdf');
  });
});

describe('DocumentsService — scheduled dispatch', () => {
  const ownerId = 'owner-1';
  const documentId = 'doc-1';
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  function document(status: DocumentStatus, overrides: Record<string, unknown> = {}) {
    return {
      id: documentId,
      ownerId,
      title: '예약 계약',
      storageKey: 'documents/owner-1/original.pdf',
      pageCount: 1,
      status,
      sentAt: null,
      scheduledSendAt: status === DocumentStatus.SCHEDULED ? new Date(future) : null,
      scheduledJobId: status === DocumentStatus.SCHEDULED ? 'old-job' : null,
      signedStorageKey: null,
      certificateStorageKey: null,
      completedAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function setup(status: DocumentStatus) {
    const row = document(status);
    const prisma = {
      document: {
        findUnique: jest.fn(async () => row),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data })),
      },
      signField: { count: jest.fn(async () => 1) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const queue = {
      add: jest.fn(async () => undefined),
      replace: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };
    const quota = { assertWithinQuota: jest.fn(async () => undefined), quota: jest.fn() };
    const notifications = { enqueueMany: jest.fn(async () => undefined) };
    const service = new DocumentsService(
      prisma as never,
      {} as never,
      notifications as never,
      { get: jest.fn(() => 'http://localhost:3000') } as never,
      quota as never,
      queue as never,
    );
    return { service, prisma, queue, quota, notifications };
  }

  const recipients = [{ email: 'signer@example.com', name: '서명자' }];

  it('stores SCHEDULED data only after adding a delayed job', async () => {
    const { service, prisma, queue } = setup(DocumentStatus.DRAFT);

    const result = await service.send(ownerId, documentId, { recipients, scheduledSendAt: future });

    expect(queue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId,
        ownerId,
        recipients: [expect.objectContaining({ email: 'signer@example.com', order: 0 })],
      }),
      new Date(future),
    );
    const [[addedJob]] = queue.add.mock.calls as unknown as Array<[{ jobId: string }]>;
    const jobId = addedJob.jobId;
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: DocumentStatus.SCHEDULED,
          scheduledSendAt: new Date(future),
          scheduledJobId: jobId,
        }),
      }),
    );
    expect(result.status).toBe(DocumentStatus.SCHEDULED);
    expect(result.scheduledSendAt).toBe(future);
  });

  it('replaces the old job ID when the scheduled time changes', async () => {
    const { service, prisma, queue } = setup(DocumentStatus.SCHEDULED);
    const next = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const result = await service.updateSchedule(ownerId, documentId, { scheduledSendAt: next });

    expect(queue.replace).toHaveBeenCalledWith('old-job', expect.any(String), new Date(next));
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scheduledSendAt: new Date(next) }) }),
    );
    expect(queue.remove).toHaveBeenCalledWith('old-job');
    expect(result.status).toBe(DocumentStatus.SCHEDULED);
    expect(result.scheduledSendAt).toBe(next);
  });

  it('removes the delayed job and returns the document to DRAFT on cancellation', async () => {
    const { service, prisma, queue } = setup(DocumentStatus.SCHEDULED);

    const result = await service.cancelSchedule(ownerId, documentId);

    expect(queue.remove).toHaveBeenCalledWith('old-job');
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: DocumentStatus.DRAFT, scheduledSendAt: null, scheduledJobId: null },
      }),
    );
    expect(result.status).toBe(DocumentStatus.DRAFT);
    expect(result.scheduledSendAt).toBeNull();
  });

  it('removes the replacement job if its database update fails', async () => {
    const { service, prisma, queue } = setup(DocumentStatus.SCHEDULED);
    prisma.document.update.mockRejectedValueOnce(new Error('database unavailable'));
    const next = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    await expect(service.updateSchedule(ownerId, documentId, { scheduledSendAt: next }))
      .rejects.toThrow('database unavailable');

    const [[, nextJobId]] = queue.replace.mock.calls as unknown as Array<[string, string]>;
    expect(queue.remove).toHaveBeenCalledWith(nextJobId);
    expect(queue.remove).not.toHaveBeenCalledWith('old-job');
  });

  it('rejects a past schedule without adding a job or changing the document', async () => {
    const { service, prisma, queue } = setup(DocumentStatus.DRAFT);

    await expect(
      service.send(ownerId, documentId, {
        recipients,
        scheduledSendAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).rejects.toThrow('예약 발송 시각은 현재보다 미래여야 해요.');

    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('dispatches a due job through the normal send path and notifies its sender', async () => {
    const { service, prisma, notifications } = setup(DocumentStatus.SCHEDULED);
    const scheduled = document(DocumentStatus.SCHEDULED, {
      owner: { email: 'owner@example.com', name: '발신자' },
    });
    prisma.document.findUnique.mockResolvedValue(scheduled);
    const dispatch = jest.fn(async () => undefined);
    (service as unknown as { dispatch: jest.Mock }).dispatch = dispatch;

    await service.dispatchScheduled({
      documentId,
      ownerId,
      jobId: 'old-job',
      recipients: [{ email: 'signer@example.com', name: '서명자', order: 0, index: 0 }],
    });

    expect(dispatch).toHaveBeenCalledWith(
      ownerId,
      expect.objectContaining({ id: documentId }),
      expect.any(Array),
      undefined,
    );
    expect(notifications.enqueueMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ to: 'owner@example.com', template: 'scheduled_send_succeeded' }),
      ]),
    );
  });

  it('notifies the sender after the worker exhausts a scheduled send job', async () => {
    const { service, prisma, notifications } = setup(DocumentStatus.SCHEDULED);
    prisma.document.findUnique.mockResolvedValue(
      document(DocumentStatus.SCHEDULED, {
        owner: { email: 'owner@example.com', name: '발신자' },
      }),
    );

    await service.notifyScheduledDispatchFailed({
      documentId,
      ownerId,
      jobId: 'old-job',
      recipients: [],
    });

    expect(notifications.enqueueMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ to: 'owner@example.com', template: 'scheduled_send_failed' }),
      ]),
    );
  });
});
