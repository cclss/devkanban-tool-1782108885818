/**
 * Integration: 확정(저장) → 발송 준비 상태 전이 + provenance 영속/복원 (grain-2~4).
 *
 * Companion to `documents.service.spec.ts` (which checks save and detail as
 * separate units). Here a *single, evolving* document record runs through the
 * whole confirm pipeline so the state machine itself is pinned:
 *
 *   DRAFT  --save(≥1 confirmed field)-->  READY (발송 준비 완료, readyToSend)
 *   READY  --detail()-->                  restores provenance + readyToSend
 *   READY  --save([] / cleared)-->        back to DRAFT (no longer ready)
 *
 * Prisma is fully mocked but *stateful*: deleteMany/createMany mutate a stored
 * row set and document.update mutates the doc, so a `detail()` after a
 * `saveFields()` reads back exactly what was just persisted — the restore the
 * "확인" step depends on. Also pins the provenance-persistence edge cases
 * (AI with no confidence, recipientIndex default, mixed sources).
 */

import { DocumentStatus, SignFieldSource } from '@repo/db';
import { DocumentsService } from './documents.service';
import { SignFieldSourceDto, SignFieldTypeDto } from './dto/documents.dto';

interface StoredField {
  id: string;
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientIndex: number | null;
  signRequestId: string | null;
  source: SignFieldSource;
  confidence: number | null;
  confirmedAt: Date | null;
}

/**
 * A stateful mocked Prisma: stores sign-field rows + a mutable doc so save and
 * the subsequent detail() see one consistent, evolving document.
 */
function makeHarness(initialStatus: DocumentStatus = DocumentStatus.DRAFT) {
  const doc = {
    id: 'doc-1',
    ownerId: 'owner-1',
    title: '계약서',
    status: initialStatus,
    pageCount: 3,
    sentAt: null as Date | null,
    completedAt: null as Date | null,
    signedStorageKey: null as string | null,
    certificateStorageKey: null as string | null,
    createdAt: new Date('2026-06-26T00:00:00.000Z'),
    updatedAt: new Date('2026-06-26T00:00:00.000Z'),
  };

  let stored: StoredField[] = [];
  let rowSeq = 0;

  const tx = {
    signField: {
      deleteMany: jest.fn(async () => {
        const count = stored.length;
        stored = [];
        return { count };
      }),
      createMany: jest.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const d of data) {
          stored.push({
            id: `row-${(rowSeq += 1)}`,
            signRequestId: null,
            ...(d as Omit<StoredField, 'id' | 'signRequestId'>),
          });
        }
        return { count: data.length };
      }),
    },
    document: {
      update: jest.fn(async ({ data }: { data: Partial<typeof doc> }) => {
        Object.assign(doc, data);
        return doc;
      }),
    },
  };

  const prisma = {
    document: {
      findUnique: jest.fn(async ({ include }: { include?: unknown }) =>
        include ? { ...doc, signRequests: [], signFields: stored } : doc,
      ),
    },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  const service = new DocumentsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, doc, tx, getStored: () => stored };
}

const baseField = {
  type: SignFieldTypeDto.SIGNATURE,
  page: 1,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.08,
};

describe('확정 → 발송 준비 상태 전이 (end to end on one document)', () => {
  it('DRAFT → save(confirmed) → READY → detail restores → clear → DRAFT', async () => {
    const h = makeHarness(DocumentStatus.DRAFT);

    // 1. Confirm one AI-as-is field → 발송 준비 완료.
    const saved = await h.service.saveFields('owner-1', 'doc-1', {
      fields: [{ ...baseField, source: SignFieldSourceDto.AI, confidence: 0.9, recipientIndex: 0 }],
    });
    expect(saved).toMatchObject({
      status: DocumentStatus.READY,
      statusLabel: '발송 준비 완료',
      readyToSend: true,
      count: 1,
    });
    expect(h.doc.status).toBe(DocumentStatus.READY);

    // 2. A revisit to "확인" restores the confirmed placement + provenance.
    const detail = await h.service.detail('owner-1', 'doc-1');
    expect(detail.readyToSend).toBe(true);
    expect(detail.statusLabel).toBe('발송 준비 완료');
    expect(detail.fields).toHaveLength(1);
    expect(detail.fields[0]).toMatchObject({
      source: SignFieldSource.AI,
      confidence: 0.9,
      recipientIndex: 0,
    });
    expect(detail.fields[0].confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO string

    // 3. Clearing every field drops the document back to a plain draft.
    const cleared = await h.service.saveFields('owner-1', 'doc-1', { fields: [] });
    expect(cleared).toMatchObject({ status: DocumentStatus.DRAFT, readyToSend: false, count: 0 });
    expect(h.doc.status).toBe(DocumentStatus.DRAFT);

    const after = await h.service.detail('owner-1', 'doc-1');
    expect(after.readyToSend).toBe(false);
    expect(after.fields).toHaveLength(0);
  });

  it('re-confirming an already-READY document keeps it READY (revisitable 확인 step)', async () => {
    const h = makeHarness(DocumentStatus.READY);
    const first = await h.service.saveFields('owner-1', 'doc-1', {
      fields: [{ ...baseField, source: SignFieldSourceDto.AI, confidence: 0.6 }],
    });
    expect(first.status).toBe(DocumentStatus.READY);
    // Already READY → no redundant status write needed.
    expect(h.tx.document.update).not.toHaveBeenCalled();

    // Save again (e.g. after an adjustment) — still READY, replacing the rows.
    const second = await h.service.saveFields('owner-1', 'doc-1', {
      fields: [{ ...baseField, source: SignFieldSourceDto.MANUAL }],
    });
    expect(second.readyToSend).toBe(true);
    expect(h.tx.signField.deleteMany).toHaveBeenCalledTimes(2); // replace each time
  });
});

describe('provenance persistence edge cases', () => {
  it('persists an AI field with no confidence as confidence null', async () => {
    const h = makeHarness();
    await h.service.saveFields('owner-1', 'doc-1', {
      fields: [{ ...baseField, source: SignFieldSourceDto.AI }],
    });
    const row = h.getStored()[0];
    expect(row.source).toBe(SignFieldSource.AI);
    expect(row.confidence).toBeNull();
    expect(row.confirmedAt).toBeInstanceOf(Date);
  });

  it('defaults a missing recipientIndex to 0 (homes the field on the first signer)', async () => {
    const h = makeHarness();
    await h.service.saveFields('owner-1', 'doc-1', {
      fields: [{ ...baseField, source: SignFieldSourceDto.AI, confidence: 0.5 }],
    });
    expect(h.getStored()[0].recipientIndex).toBe(0);
  });

  it('persists mixed provenance in one save and restores it intact', async () => {
    const h = makeHarness();
    await h.service.saveFields('owner-1', 'doc-1', {
      fields: [
        { ...baseField, type: SignFieldTypeDto.SIGNATURE, source: SignFieldSourceDto.AI, confidence: 0.8 },
        { ...baseField, type: SignFieldTypeDto.DATE, page: 2, source: SignFieldSourceDto.MANUAL, confidence: 0.99 },
        { ...baseField, type: SignFieldTypeDto.TEXT, page: 2, recipientIndex: 1 },
      ],
    });

    const detail = await h.service.detail('owner-1', 'doc-1');
    expect(detail.fields).toHaveLength(3);
    // AI-as-is keeps its confidence…
    expect(detail.fields[0]).toMatchObject({ source: SignFieldSource.AI, confidence: 0.8 });
    // …MANUAL drops confidence even when one was supplied…
    expect(detail.fields[1]).toMatchObject({ source: SignFieldSource.MANUAL, confidence: null });
    // …and a field with no explicit source persists as MANUAL with index default.
    expect(detail.fields[2]).toMatchObject({
      source: SignFieldSource.MANUAL,
      confidence: null,
      recipientIndex: 1,
    });
    expect(detail.readyToSend).toBe(true);
  });
});
