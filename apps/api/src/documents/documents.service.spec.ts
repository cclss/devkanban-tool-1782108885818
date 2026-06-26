/**
 * Unit tests for the sign-field provenance + send-readiness persistence (grain-2).
 *
 * Covers the data-layer guarantees the grain asks for, with a fully mocked
 * Prisma client (no DB):
 *   • save     — confirmed fields persist source / confidence / confirmedAt, and
 *                the document flips to READY ("발송 준비 완료"); clearing → DRAFT.
 *   • restore  — `detail()` returns the provenance + a readyToSend flag so a
 *                revisit can rebuild exactly what was confirmed.
 *   • back-compat — a field with no `source` persists as MANUAL with null
 *                confidence; legacy rows (null confirmedAt) round-trip cleanly;
 *                MANUAL never keeps a confidence even if one is supplied.
 */

import { DocumentStatus, SignFieldSource } from '@repo/db';
import { DocumentsService } from './documents.service';
import { SignFieldSourceDto, SignFieldTypeDto } from './dto/documents.dto';
import { MESSAGES } from '../common/messages';

type DocRecord = {
  id: string;
  ownerId: string;
  title: string;
  status: DocumentStatus;
  pageCount: number;
  sentAt: Date | null;
  completedAt: Date | null;
  signedStorageKey: string | null;
  certificateStorageKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeDoc(over: Partial<DocRecord> = {}): DocRecord {
  return {
    id: 'doc-1',
    ownerId: 'owner-1',
    title: '계약서',
    status: DocumentStatus.DRAFT,
    pageCount: 2,
    sentAt: null,
    completedAt: null,
    signedStorageKey: null,
    certificateStorageKey: null,
    createdAt: new Date('2026-06-26T00:00:00.000Z'),
    updatedAt: new Date('2026-06-26T00:00:00.000Z'),
    ...over,
  };
}

/** Build a service with a mocked Prisma; expose the tx spies for assertions. */
function makeService(doc: DocRecord) {
  const tx = {
    signField: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      createMany: jest.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => ({
        count: data.length,
      })),
    },
    document: {
      update: jest.fn(async ({ data }: { data: Partial<DocRecord> }) => {
        Object.assign(doc, data);
        return doc;
      }),
    },
  };

  const prisma = {
    document: {
      findUnique: jest.fn(async ({ include }: { include?: unknown }) =>
        include ? { ...doc, signRequests: [], signFields: detailFields } : doc,
      ),
    },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  // `detailFields` is set per-test for the restore cases.
  let detailFields: unknown[] = [];
  const service = new DocumentsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return {
    service,
    tx,
    prisma,
    setDetailFields: (f: unknown[]) => {
      detailFields = f;
    },
  };
}

const baseField = {
  type: SignFieldTypeDto.SIGNATURE,
  page: 1,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.08,
};

describe('DocumentsService.saveFields — provenance + 발송 준비 완료', () => {
  it('persists AI provenance and flips the document to READY', async () => {
    const doc = makeDoc({ status: DocumentStatus.DRAFT });
    const { service, tx } = makeService(doc);

    const result = await service.saveFields('owner-1', 'doc-1', {
      fields: [
        { ...baseField, source: SignFieldSourceDto.AI, confidence: 0.92, recipientIndex: 0 },
      ],
    });

    const persisted = tx.signField.createMany.mock.calls[0][0].data[0];
    expect(persisted.source).toBe(SignFieldSource.AI);
    expect(persisted.confidence).toBe(0.92);
    expect(persisted.confirmedAt).toBeInstanceOf(Date);

    expect(tx.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: DocumentStatus.READY } }),
    );
    expect(result).toEqual({
      count: 1,
      status: DocumentStatus.READY,
      statusLabel: '발송 준비 완료',
      readyToSend: true,
    });
  });

  it('defaults a field with no source to MANUAL with null confidence (back-compat)', async () => {
    const doc = makeDoc();
    const { service, tx } = makeService(doc);

    await service.saveFields('owner-1', 'doc-1', { fields: [{ ...baseField }] });

    const persisted = tx.signField.createMany.mock.calls[0][0].data[0];
    expect(persisted.source).toBe(SignFieldSource.MANUAL);
    expect(persisted.confidence).toBeNull();
  });

  it('drops confidence for a MANUAL field even if one is supplied', async () => {
    const doc = makeDoc();
    const { service, tx } = makeService(doc);

    await service.saveFields('owner-1', 'doc-1', {
      fields: [{ ...baseField, source: SignFieldSourceDto.MANUAL, confidence: 0.99 }],
    });

    const persisted = tx.signField.createMany.mock.calls[0][0].data[0];
    expect(persisted.source).toBe(SignFieldSource.MANUAL);
    expect(persisted.confidence).toBeNull();
  });

  it('clears fields → drops back to DRAFT and creates nothing', async () => {
    const doc = makeDoc({ status: DocumentStatus.READY });
    const { service, tx } = makeService(doc);

    const result = await service.saveFields('owner-1', 'doc-1', { fields: [] });

    expect(tx.signField.deleteMany).toHaveBeenCalled();
    expect(tx.signField.createMany).not.toHaveBeenCalled();
    expect(tx.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: DocumentStatus.DRAFT } }),
    );
    expect(result.readyToSend).toBe(false);
    expect(result.status).toBe(DocumentStatus.DRAFT);
  });

  it('allows re-confirming an already-READY document (no redundant status write)', async () => {
    const doc = makeDoc({ status: DocumentStatus.READY });
    const { service, tx } = makeService(doc);

    const result = await service.saveFields('owner-1', 'doc-1', {
      fields: [{ ...baseField, source: SignFieldSourceDto.AI, confidence: 0.5 }],
    });

    expect(result.status).toBe(DocumentStatus.READY);
    // Already READY → no status update needed.
    expect(tx.document.update).not.toHaveBeenCalled();
  });

  it('rejects saving fields on an already-sent contract', async () => {
    const doc = makeDoc({ status: DocumentStatus.IN_PROGRESS });
    const { service } = makeService(doc);

    await expect(
      service.saveFields('owner-1', 'doc-1', { fields: [{ ...baseField }] }),
    ).rejects.toThrow(MESSAGES.send.alreadySent);
  });
});

describe('DocumentsService.detail — restore provenance + readyToSend', () => {
  it('restores fields with source/confidence/confirmedAt and the readyToSend flag', async () => {
    const doc = makeDoc({ status: DocumentStatus.READY });
    const ctx = makeService(doc);
    ctx.setDetailFields([
      {
        id: 'f1',
        type: 'SIGNATURE',
        page: 1,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.08,
        recipientIndex: 0,
        signRequestId: null,
        source: SignFieldSource.AI,
        confidence: 0.9,
        confirmedAt: new Date('2026-06-26T01:02:03.000Z'),
      },
    ]);

    const detail = await ctx.service.detail('owner-1', 'doc-1');

    expect(detail.readyToSend).toBe(true);
    expect(detail.statusLabel).toBe('발송 준비 완료');
    expect(detail.fields[0]).toMatchObject({
      source: SignFieldSource.AI,
      confidence: 0.9,
      confirmedAt: '2026-06-26T01:02:03.000Z',
    });
  });

  it('round-trips legacy rows (manual, null confidence/confirmedAt) cleanly', async () => {
    const doc = makeDoc({ status: DocumentStatus.DRAFT });
    const ctx = makeService(doc);
    ctx.setDetailFields([
      {
        id: 'legacy',
        type: 'DATE',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.05,
        recipientIndex: 0,
        signRequestId: null,
        source: SignFieldSource.MANUAL,
        confidence: null,
        confirmedAt: null,
      },
    ]);

    const detail = await ctx.service.detail('owner-1', 'doc-1');

    expect(detail.readyToSend).toBe(false);
    expect(detail.fields[0]).toMatchObject({
      source: SignFieldSource.MANUAL,
      confidence: null,
      confirmedAt: null,
    });
  });
});
