import { DocumentStatus } from '@repo/db';
import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { MESSAGES } from '../common/messages';
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

    service = new DocumentsService(
      prisma as never,
      storage as never,
      notifications as never,
      config as never,
      sendQuota as never,
      {} as never,
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

/**
 * `toSummary` exposes the scheduled-send instant (grain-1). A SCHEDULED document
 * surfaces its `scheduledSendAt` as an ISO string so the dashboard can render
 * "예약됨 · {일시}"; every other status carries `null`. Exercised through the
 * public `list()` path (the create/send paths always persist a null schedule).
 */
describe('DocumentsService — scheduledSendAt in summary', () => {
  const SCHEDULE = new Date('2026-08-20T09:00:00.000Z');

  /** A persisted Document row with the fields `toSummary` reads. */
  function docRow(overrides: Record<string, unknown>) {
    return {
      id: 'doc-1',
      ownerId: 'owner-1',
      title: '계약서',
      storageKey: 'owner-1/계약서.pdf',
      pageCount: 1,
      status: DocumentStatus.DRAFT,
      sentAt: null,
      scheduledSendAt: null,
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
      completedAt: null,
      signedStorageKey: null,
      certificateStorageKey: null,
      _count: { signRequests: 0 },
      signRequests: [],
      ...overrides,
    };
  }

  function serviceWith(rows: ReturnType<typeof docRow>[]) {
    const prisma = {
      document: { findMany: jest.fn(async () => rows) },
    };
    return new DocumentsService(
      prisma as never,
      {} as never,
      {} as never,
      { get: jest.fn(() => undefined) } as never,
      {} as never,
      {} as never,
    );
  }

  it('exposes scheduledSendAt as an ISO string for a SCHEDULED document', async () => {
    const service = serviceWith([
      docRow({ status: DocumentStatus.SCHEDULED, scheduledSendAt: SCHEDULE }),
    ]);

    const [summary] = await service.list('owner-1');

    expect(summary.status).toBe(DocumentStatus.SCHEDULED);
    expect(summary.scheduledSendAt).toBe(SCHEDULE.toISOString());
  });

  it('leaves scheduledSendAt null when the document has no pending schedule', async () => {
    const service = serviceWith([docRow({ status: DocumentStatus.DRAFT })]);

    const [summary] = await service.list('owner-1');

    expect(summary.scheduledSendAt).toBeNull();
  });
});

describe('DocumentsService.dispatchScheduled — scheduled-send worker callback', () => {
  const RECIPIENTS = [{ email: 'a@ex.com', name: '갑', order: 0, index: 0 }];

  /** A prisma double that records whether the dispatch transaction ran. */
  function makeService(doc: Record<string, unknown> | null) {
    const signRequestCreate = jest.fn(async () => ({ id: 'sr-1' }));
    const documentUpdate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...doc,
      ...data,
    }));
    const auditCreate = jest.fn(async () => ({}));
    const tx = {
      signRequest: { create: signRequestCreate },
      signField: { updateMany: jest.fn(async () => ({ count: 0 })) },
      document: { update: documentUpdate },
      auditLog: { create: auditCreate },
    };
    const $transaction = jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx));
    const prisma = {
      document: { findUnique: jest.fn(async () => doc) },
      $transaction,
    };
    const notifications = { enqueueMany: jest.fn(async () => undefined) };
    const sendQuota = { assertWithinQuota: jest.fn(async () => undefined) };
    const service = new DocumentsService(
      prisma as never,
      {} as never,
      notifications as never,
      { get: jest.fn(() => undefined) } as never,
      sendQuota as never,
      {} as never,
    );
    return { service, $transaction, notifications, documentUpdate, signRequestCreate, auditCreate };
  }

  it('auto-sends a still-SCHEDULED document: IN_PROGRESS transition + one SignRequest per recipient + recipient notices', async () => {
    const { service, $transaction, notifications, documentUpdate, signRequestCreate, auditCreate } =
      makeService({
        id: 'doc-1',
        ownerId: 'owner-1',
        title: '계약서',
        status: DocumentStatus.SCHEDULED,
      });

    await service.dispatchScheduled({
      documentId: 'doc-1',
      ownerId: 'owner-1',
      recipients: RECIPIENTS,
    });

    // The dispatch core ran inside a single transaction …
    expect($transaction).toHaveBeenCalledTimes(1);
    // … flipping the document to 진행 중 and clearing the reservation columns so it
    // no longer reads as 예약됨.
    expect(documentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-1' },
        data: expect.objectContaining({
          status: DocumentStatus.IN_PROGRESS,
          scheduledSendAt: null,
          scheduledJobId: null,
        }),
      }),
    );
    // … creating one SignRequest for the captured recipient and auditing the send …
    expect(signRequestCreate).toHaveBeenCalledTimes(1);
    expect(signRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ documentId: 'doc-1', recipientEmail: 'a@ex.com' }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CONTRACT_SENT' }),
      }),
    );
    // … and notifying that recipient over both channels.
    expect(notifications.enqueueMany).toHaveBeenCalledTimes(1);
    const jobs = (notifications.enqueueMany.mock.calls[0] as unknown as [
      Array<{ channel: string; to: string }>,
    ])[0];
    expect(jobs.map((j) => j.channel).sort()).toEqual(['alimtalk', 'email']);
    expect(jobs.every((j) => j.to === 'a@ex.com')).toBe(true);
  });

  it('is a no-op for a document no longer SCHEDULED (stale/cancelled job): no double-send', async () => {
    const { service, $transaction, notifications, documentUpdate } = makeService({
      id: 'doc-1',
      status: DocumentStatus.DRAFT,
    });

    await service.dispatchScheduled({
      documentId: 'doc-1',
      ownerId: 'owner-1',
      recipients: RECIPIENTS,
    });

    expect($transaction).not.toHaveBeenCalled();
    expect(documentUpdate).not.toHaveBeenCalled();
    expect(notifications.enqueueMany).not.toHaveBeenCalled();
  });

  it('is a no-op for an already-sent (IN_PROGRESS) document: a raced job never re-dispatches', async () => {
    const { service, $transaction, notifications } = makeService({
      id: 'doc-1',
      status: DocumentStatus.IN_PROGRESS,
    });

    await service.dispatchScheduled({
      documentId: 'doc-1',
      ownerId: 'owner-1',
      recipients: RECIPIENTS,
    });

    expect($transaction).not.toHaveBeenCalled();
    expect(notifications.enqueueMany).not.toHaveBeenCalled();
  });

  it('is a no-op for a missing (deleted) document: no resurrection', async () => {
    const { service, $transaction, notifications } = makeService(null);

    await service.dispatchScheduled({
      documentId: 'gone',
      ownerId: 'owner-1',
      recipients: RECIPIENTS,
    });

    expect($transaction).not.toHaveBeenCalled();
    // A deleted document must never spawn SignRequests or notifications.
    expect(notifications.enqueueMany).not.toHaveBeenCalled();
  });
});

/**
 * `send`'s immediate-vs-scheduled split (grain-3). With no `scheduledSendAt` the
 * existing immediate path is preserved (dispatch runs, nothing is queued). With a
 * future `scheduledSendAt` the contract is queued instead: a delayed job is
 * registered, the document is parked as SCHEDULED with the reservation instant +
 * job id, an audit entry is written, and NO SignRequests/notifications are
 * created. Past / unparseable instants are rejected with the design-spec-toned
 * copy before anything is scheduled.
 */
describe('DocumentsService.send — immediate vs scheduled branch', () => {
  const RECIPIENTS = [{ email: 'A@Ex.com', name: ' 갑 ' }];

  const DRAFT_DOC = {
    id: 'doc-1',
    ownerId: 'owner-1',
    title: '계약서',
    storageKey: 'owner-1/계약서.pdf',
    pageCount: 1,
    status: DocumentStatus.DRAFT,
    sentAt: null,
    scheduledSendAt: null,
    scheduledJobId: null,
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    completedAt: null,
    signedStorageKey: null,
    certificateStorageKey: null,
  };

  function makeService() {
    const tx = {
      signRequest: { create: jest.fn(async () => ({ id: 'sr-1' })) },
      signField: { updateMany: jest.fn(async () => ({ count: 0 })) },
      document: {
        update: jest.fn(async () => ({
          ...DRAFT_DOC,
          status: DocumentStatus.IN_PROGRESS,
          sentAt: new Date('2026-08-12T01:00:00.000Z'),
        })),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const $transaction = jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx));
    const prisma = {
      document: {
        findUnique: jest.fn(async () => DRAFT_DOC),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...DRAFT_DOC,
          ...data,
        })),
      },
      signField: { count: jest.fn(async () => 2) },
      auditLog: { create: jest.fn(async () => ({})) },
      $transaction,
    };
    const notifications = { enqueueMany: jest.fn(async () => undefined) };
    const sendQuota = { assertWithinQuota: jest.fn(async () => undefined) };
    const scheduledSend = {
      schedule: jest.fn(async () => 'job-42'),
      remove: jest.fn(async () => undefined),
    };
    const service = new DocumentsService(
      prisma as never,
      {} as never,
      notifications as never,
      { get: jest.fn(() => undefined) } as never,
      sendQuota as never,
      scheduledSend as never,
    );
    return { service, prisma, $transaction, notifications, sendQuota, scheduledSend };
  }

  /** An ISO instant safely in the future relative to the test's wall clock. */
  function futureIso(msAhead = 60 * 60 * 1000): string {
    return new Date(Date.now() + msAhead).toISOString();
  }

  it('dispatches immediately (unchanged path) when no scheduledSendAt is given', async () => {
    const { service, $transaction, notifications, scheduledSend, sendQuota } =
      makeService();

    const summary = await service.send('owner-1', 'doc-1', { recipients: RECIPIENTS });

    // The immediate dispatch core ran and notified recipients …
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(notifications.enqueueMany).toHaveBeenCalledTimes(1);
    expect(sendQuota.assertWithinQuota).toHaveBeenCalled();
    // … and nothing was queued.
    expect(scheduledSend.schedule).not.toHaveBeenCalled();
    expect(summary.status).toBe(DocumentStatus.IN_PROGRESS);
  });

  it('queues a delayed job and parks the document as SCHEDULED for a future instant', async () => {
    const { service, prisma, $transaction, notifications, scheduledSend } =
      makeService();
    const when = futureIso();

    const summary = await service.send('owner-1', 'doc-1', {
      recipients: RECIPIENTS,
      scheduledSendAt: when,
    });

    // A delayed job was registered with the normalized recipients + a ~1h delay.
    expect(scheduledSend.schedule).toHaveBeenCalledTimes(1);
    const [docId, delayMs, payload] = scheduledSend.schedule.mock
      .calls[0] as unknown as [
      string,
      number,
      { ownerId: string; recipients: Array<{ email: string; name: string | null }> },
    ];
    expect(docId).toBe('doc-1');
    expect(delayMs).toBeGreaterThan(0);
    expect(payload.ownerId).toBe('owner-1');
    // Recipients were normalized (lowercased email, trimmed name) before queueing.
    expect(payload.recipients[0]).toMatchObject({ email: 'a@ex.com', name: '갑' });

    // The document was flipped to SCHEDULED with the instant + returned job id.
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: DocumentStatus.SCHEDULED,
          scheduledJobId: 'job-42',
          scheduledSendAt: expect.any(Date),
        }),
      }),
    );
    // An audit entry was written, but NO dispatch/notifications happened.
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CONTRACT_SCHEDULED' }),
      }),
    );
    expect($transaction).not.toHaveBeenCalled();
    expect(notifications.enqueueMany).not.toHaveBeenCalled();

    // The summary reflects the reservation.
    expect(summary.status).toBe(DocumentStatus.SCHEDULED);
    expect(summary.scheduledSendAt).toBe(new Date(when).toISOString());
  });

  it('rejects a past scheduledSendAt with the toned copy, scheduling nothing', async () => {
    const { service, prisma, scheduledSend } = makeService();
    const past = new Date(Date.now() - 60 * 1000).toISOString();

    await expect(
      service.send('owner-1', 'doc-1', { recipients: RECIPIENTS, scheduledSendAt: past }),
    ).rejects.toThrow(MESSAGES.send.scheduledInPast);
    expect(scheduledSend.schedule).not.toHaveBeenCalled();
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('rejects an unparseable scheduledSendAt with the toned copy', async () => {
    const { service, scheduledSend } = makeService();

    await expect(
      service.send('owner-1', 'doc-1', {
        recipients: RECIPIENTS,
        scheduledSendAt: 'not-a-real-date',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.send('owner-1', 'doc-1', {
        recipients: RECIPIENTS,
        scheduledSendAt: 'not-a-real-date',
      }),
    ).rejects.toThrow(MESSAGES.send.scheduledInvalid);
    expect(scheduledSend.schedule).not.toHaveBeenCalled();
  });
});

/**
 * Reschedule (PATCH) + cancel (DELETE) of a pending reservation (grain-4).
 *
 * PATCH moves the reservation: the recipients captured at schedule time are
 * recovered from the pending job (`peek`), the old job is removed, a fresh delayed
 * job is registered under the new delay, and the document's `scheduledSendAt` +
 * `scheduledJobId` are updated (still SCHEDULED, no dispatch/notifications).
 * DELETE returns the contract to DRAFT, clears the reservation columns, and
 * removes the job. Both are owner-gated and SCHEDULED-only.
 */
describe('DocumentsService.reschedule / cancelSchedule — manage a reservation', () => {
  const PAYLOAD = {
    ownerId: 'owner-1',
    recipients: [{ email: 'a@ex.com', name: '갑', order: 0, index: 0 }],
    ip: '10.0.0.1',
  };

  const SCHEDULED_DOC = {
    id: 'doc-1',
    ownerId: 'owner-1',
    title: '계약서',
    storageKey: 'owner-1/계약서.pdf',
    pageCount: 1,
    status: DocumentStatus.SCHEDULED,
    sentAt: null,
    scheduledSendAt: new Date('2026-08-20T09:00:00.000Z'),
    scheduledJobId: 'job-old',
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    completedAt: null,
    signedStorageKey: null,
    certificateStorageKey: null,
  };

  function makeService(docOverrides: Record<string, unknown> = {}) {
    const doc = { ...SCHEDULED_DOC, ...docOverrides };
    const prisma = {
      document: {
        findUnique: jest.fn(async () => doc),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...doc,
          ...data,
        })),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const scheduledSend = {
      schedule: jest.fn(async () => 'job-new'),
      remove: jest.fn(async () => undefined),
      peek: jest.fn(async () => PAYLOAD),
    };
    const service = new DocumentsService(
      prisma as never,
      {} as never,
      {} as never,
      { get: jest.fn(() => undefined) } as never,
      {} as never,
      scheduledSend as never,
    );
    return { service, prisma, scheduledSend };
  }

  function futureIso(msAhead = 2 * 60 * 60 * 1000): string {
    return new Date(Date.now() + msAhead).toISOString();
  }

  it('re-registers the job at the new instant and updates the reservation columns', async () => {
    const { service, prisma, scheduledSend } = makeService();
    const when = futureIso();

    const summary = await service.reschedule('owner-1', 'doc-1', {
      scheduledSendAt: when,
    });

    // Recovered the pending job's recipients, removed the old job, then scheduled
    // a fresh one — in that order.
    expect(scheduledSend.peek).toHaveBeenCalledWith('job-old');
    expect(scheduledSend.remove).toHaveBeenCalledWith('job-old');
    const [docId, delayMs, payload] = scheduledSend.schedule.mock
      .calls[0] as unknown as [string, number, typeof PAYLOAD];
    expect(docId).toBe('doc-1');
    expect(delayMs).toBeGreaterThan(0);
    // The recovered recipients travel to the new job untouched.
    expect(payload.recipients).toEqual(PAYLOAD.recipients);

    // The reservation instant + new job id were persisted; status stays SCHEDULED.
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduledJobId: 'job-new',
          scheduledSendAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CONTRACT_RESCHEDULED' }),
      }),
    );
    expect(summary.status).toBe(DocumentStatus.SCHEDULED);
    expect(summary.scheduledSendAt).toBe(new Date(when).toISOString());
  });

  it('rejects a reschedule on a non-SCHEDULED document, touching no job', async () => {
    const { service, prisma, scheduledSend } = makeService({
      status: DocumentStatus.DRAFT,
    });

    await expect(
      service.reschedule('owner-1', 'doc-1', { scheduledSendAt: futureIso() }),
    ).rejects.toThrow(MESSAGES.send.notScheduled);
    expect(scheduledSend.remove).not.toHaveBeenCalled();
    expect(scheduledSend.schedule).not.toHaveBeenCalled();
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('rejects a reschedule from a non-owner (forbidden)', async () => {
    const { service, scheduledSend } = makeService();

    await expect(
      service.reschedule('intruder', 'doc-1', { scheduledSendAt: futureIso() }),
    ).rejects.toThrow(MESSAGES.document.forbidden);
    expect(scheduledSend.schedule).not.toHaveBeenCalled();
  });

  it('rejects a past reschedule instant with the toned copy, scheduling nothing', async () => {
    const { service, prisma, scheduledSend } = makeService();
    const past = new Date(Date.now() - 60 * 1000).toISOString();

    await expect(
      service.reschedule('owner-1', 'doc-1', { scheduledSendAt: past }),
    ).rejects.toThrow(MESSAGES.send.scheduledInPast);
    expect(scheduledSend.remove).not.toHaveBeenCalled();
    expect(scheduledSend.schedule).not.toHaveBeenCalled();
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('rejects when the pending job is gone (recipients unrecoverable)', async () => {
    const { service, prisma, scheduledSend } = makeService();
    scheduledSend.peek.mockResolvedValueOnce(null as never);

    await expect(
      service.reschedule('owner-1', 'doc-1', { scheduledSendAt: futureIso() }),
    ).rejects.toThrow(MESSAGES.send.scheduleUnavailable);
    // Nothing was removed or re-scheduled since we could not rebuild the job.
    expect(scheduledSend.remove).not.toHaveBeenCalled();
    expect(scheduledSend.schedule).not.toHaveBeenCalled();
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('cancels: DRAFT + null reservation columns + job removed', async () => {
    const { service, prisma, scheduledSend } = makeService();

    const summary = await service.cancelSchedule('owner-1', 'doc-1');

    // Persisted DRAFT + cleared columns BEFORE removing the job (fail-safe order).
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: DocumentStatus.DRAFT,
          scheduledSendAt: null,
          scheduledJobId: null,
        }),
      }),
    );
    expect(scheduledSend.remove).toHaveBeenCalledWith('job-old');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CONTRACT_SCHEDULE_CANCELLED' }),
      }),
    );
    expect(summary.status).toBe(DocumentStatus.DRAFT);
    expect(summary.scheduledSendAt).toBeNull();
  });

  it('rejects a cancel on a non-SCHEDULED document, touching no job', async () => {
    const { service, prisma, scheduledSend } = makeService({
      status: DocumentStatus.IN_PROGRESS,
    });

    await expect(service.cancelSchedule('owner-1', 'doc-1')).rejects.toThrow(
      MESSAGES.send.notScheduled,
    );
    expect(scheduledSend.remove).not.toHaveBeenCalled();
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('rejects a cancel from a non-owner (forbidden)', async () => {
    const { service, scheduledSend } = makeService();

    await expect(service.cancelSchedule('intruder', 'doc-1')).rejects.toThrow(
      MESSAGES.document.forbidden,
    );
    expect(scheduledSend.remove).not.toHaveBeenCalled();
  });
});

describe('DocumentsService.notifyScheduledSendFailure — sender alert + recovery', () => {
  type FailureDoc = {
    status: DocumentStatus;
    ownerId: string;
    scheduledJobId: string | null;
    title: string;
    owner: { email: string; name: string | null };
  };

  function makeService(doc: FailureDoc | null) {
    const documentUpdate = jest.fn(async () => ({}));
    const auditCreate = jest.fn(async () => ({}));
    const tx = {
      document: { update: documentUpdate },
      auditLog: { create: auditCreate },
    };
    const $transaction = jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
    const notifications = { enqueueMany: jest.fn(async () => undefined) };
    const prisma = {
      document: { findUnique: jest.fn(async () => doc) },
      $transaction,
    };
    const service = new DocumentsService(
      prisma as never,
      {} as never,
      notifications as never,
      { get: jest.fn(() => undefined) } as never,
      {} as never,
      {} as never,
    );
    return { service, notifications, $transaction, documentUpdate, auditCreate };
  }

  const SCHEDULED_DOC: FailureDoc = {
    status: DocumentStatus.SCHEDULED,
    ownerId: 'owner-1',
    scheduledJobId: 'job_abc',
    title: '계약서',
    owner: { email: 'sender@toss.im', name: '토스' },
  };

  it('enqueues an email + alimtalk failure notice to the sender', async () => {
    const { service, notifications } = makeService(SCHEDULED_DOC);

    await service.notifyScheduledSendFailure('doc-1', 'Error: boom');

    expect(notifications.enqueueMany).toHaveBeenCalledTimes(1);
    const jobs = (notifications.enqueueMany.mock.calls[0] as unknown as [
      Array<{ channel: string; to: string; template: string; data: Record<string, unknown> }>,
    ])[0];
    expect(jobs.map((j) => j.channel).sort()).toEqual(['alimtalk', 'email']);
    expect(jobs.every((j) => j.to === 'sender@toss.im')).toBe(true);
    expect(jobs.every((j) => j.template === 'scheduled_send_failed')).toBe(true);
    // Internal error detail must never leak into the user-facing notification.
    expect(jobs.every((j) => !('reason' in j.data))).toBe(true);
  });

  it('recovers a still-SCHEDULED document to a re-sendable DRAFT (reservation columns nulled + audit) AND alerts the sender', async () => {
    const { service, notifications, $transaction, documentUpdate, auditCreate } =
      makeService(SCHEDULED_DOC);

    await service.notifyScheduledSendFailure('doc-1', 'Error: boom');

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(documentUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: {
        status: DocumentStatus.DRAFT,
        scheduledSendAt: null,
        scheduledJobId: null,
      },
    });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentId: 'doc-1',
          action: 'SCHEDULED_SEND_FAILED',
        }),
      }),
    );
    // The final-failure path runs end-to-end: recovery THEN the sender alert, so a
    // permanently-failed reservation both frees the document and tells the sender.
    expect(notifications.enqueueMany).toHaveBeenCalledTimes(1);
  });

  it('does NOT recover when the document is no longer SCHEDULED (raced cancel/reschedule), but still alerts', async () => {
    const { service, notifications, $transaction, documentUpdate } = makeService({
      ...SCHEDULED_DOC,
      status: DocumentStatus.DRAFT,
    });

    await service.notifyScheduledSendFailure('doc-1', 'Error: boom');

    expect($transaction).not.toHaveBeenCalled();
    expect(documentUpdate).not.toHaveBeenCalled();
    // The alert still goes out even when recovery is skipped.
    expect(notifications.enqueueMany).toHaveBeenCalledTimes(1);
  });

  it('never throws and still alerts when the recovery write fails', async () => {
    const { service, notifications } = makeService(SCHEDULED_DOC);
    // Force the recovery transaction to blow up.
    (service as unknown as { prisma: { $transaction: jest.Mock } }).prisma.$transaction =
      jest.fn(async () => {
        throw new Error('db down');
      });

    await expect(
      service.notifyScheduledSendFailure('doc-1', 'Error: boom'),
    ).resolves.toBeUndefined();
    expect(notifications.enqueueMany).toHaveBeenCalledTimes(1);
  });

  it('skips both recovery and alert when the document is gone', async () => {
    const { service, notifications, $transaction } = makeService(null);

    await service.notifyScheduledSendFailure('missing', 'Error: boom');

    expect($transaction).not.toHaveBeenCalled();
    expect(notifications.enqueueMany).not.toHaveBeenCalled();
  });
});
