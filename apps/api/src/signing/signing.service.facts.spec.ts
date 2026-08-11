import { DocumentStatus, SignRequestStatus } from '@repo/db';
import { SigningService, deriveContractFacts } from './signing.service';
import type { ExtractedClause } from '../pdf/clause-extraction.types';

/**
 * grain-1 (spec §6 / M-7): server projection of the completion + re-entry facts.
 *
 *  • `complete()` returns `signedAt` (ISO) plus `contractDate` / `contractAmount`
 *    derived from the extracted clause figures (null when not extractable);
 *  • `meta()` projects those same facts for re-entry once SIGNED, and
 *    `documentReady` gates the download button (COMPLETED + signedStorageKey).
 *
 * The derivation itself is a pure helper (`deriveContractFacts`) tested in
 * isolation below.
 */
describe('SigningService — completion & re-entry facts (grain-1)', () => {
  const STORAGE_KEY = 'documents/owner/doc.pdf';
  const SIGNED_KEY = 'documents/owner/doc.signed.pdf';

  const CLAUSES: ExtractedClause[] = [
    {
      title: '제1조 (계약금액)',
      plainText: '이 계약의 대금은 1,200만원으로 한다.',
      figures: [{ kind: 'money', value: '1,200만원' }],
      caution: false,
      page: 1,
    },
    {
      title: '제2조 (계약기간)',
      plainText: '이 계약은 2026년 8월 11일부터 1년간 유효하다.',
      figures: [
        { kind: 'date', value: '2026년 8월 11일' },
        { kind: 'period', value: '1년' },
      ],
      caution: false,
      page: 1,
    },
  ];

  // --- deriveContractFacts (pure) -----------------------------------------

  describe('deriveContractFacts', () => {
    it('picks the first date and first money figure in reading order', () => {
      expect(deriveContractFacts(CLAUSES)).toEqual({
        contractDate: '2026년 8월 11일',
        contractAmount: '1,200만원',
      });
    });

    it('returns null for a kind that never appears', () => {
      const onlyMoney: ExtractedClause[] = [
        { title: 'x', plainText: 'x', figures: [{ kind: 'money', value: '5만원' }], caution: false, page: 1 },
      ];
      expect(deriveContractFacts(onlyMoney)).toEqual({
        contractDate: null,
        contractAmount: '5만원',
      });
    });

    it('returns both null for no clauses / no figures', () => {
      expect(deriveContractFacts([])).toEqual({ contractDate: null, contractAmount: null });
      expect(
        deriveContractFacts([
          { title: 'x', plainText: 'x', figures: [], caution: false, page: 1 },
        ]),
      ).toEqual({ contractDate: null, contractAmount: null });
    });

    it('keeps the earliest figure of each kind across multiple clauses', () => {
      const many: ExtractedClause[] = [
        { title: 'a', plainText: 'a', figures: [{ kind: 'date', value: 'D1' }], caution: false, page: 1 },
        { title: 'b', plainText: 'b', figures: [{ kind: 'money', value: 'M1' }, { kind: 'date', value: 'D2' }], caution: false, page: 2 },
      ];
      expect(deriveContractFacts(many)).toEqual({ contractDate: 'D1', contractAmount: 'M1' });
    });
  });

  // --- complete() ----------------------------------------------------------

  function buildForComplete(extract: () => Promise<ExtractedClause[]>) {
    const row = {
      id: 'sr_1',
      status: SignRequestStatus.VIEWED,
      documentId: 'doc_1',
      document: { status: DocumentStatus.IN_PROGRESS, storageKey: STORAGE_KEY },
      signFields: [{ id: 'f1', value: 'data:image/png;base64,AAAA' }],
    };
    const tx = {
      signRequest: {
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0), // last signer → document COMPLETED
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      document: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      signRequest: { findUnique: jest.fn().mockResolvedValue(row) },
      $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const storage = { read: jest.fn(async () => Buffer.from('%PDF-1.7 fake')) };
    const clauseExtraction = { extractFromPdf: jest.fn(extract) };
    const service = new SigningService(
      prisma as never,
      storage as never,
      { issue: jest.fn() } as never,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as never,
      clauseExtraction as never,
    );
    return { service, storage };
  }

  it('complete() returns signedAt (ISO) + derived contract facts', async () => {
    const { service } = buildForComplete(async () => CLAUSES);
    const before = Date.now();
    const result = await service.complete('sr_1');
    const after = Date.now();

    expect(result.status).toBe(SignRequestStatus.SIGNED);
    expect(result.documentCompleted).toBe(true);
    expect(result.contractDate).toBe('2026년 8월 11일');
    expect(result.contractAmount).toBe('1,200만원');

    // signedAt is a valid ISO timestamp taken at completion time.
    const ts = Date.parse(result.signedAt);
    expect(Number.isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
    expect(result.signedAt).toBe(new Date(ts).toISOString());
  });

  it('complete() yields null facts (no throw) when extraction fails', async () => {
    const { service } = buildForComplete(async () => {
      throw new Error('corrupt PDF');
    });
    const result = await service.complete('sr_1');
    expect(result.contractDate).toBeNull();
    expect(result.contractAmount).toBeNull();
    expect(typeof result.signedAt).toBe('string');
  });

  // --- meta() re-entry projection -----------------------------------------

  function buildForMeta(opts: {
    status: SignRequestStatus;
    documentStatus: DocumentStatus;
    signedStorageKey?: string | null;
    signedAt?: Date | null;
    extract?: () => Promise<ExtractedClause[]>;
  }) {
    const row = {
      id: 'sr_1',
      accessToken: 'tok',
      status: opts.status,
      recipientName: '홍길동',
      signedAt: opts.signedAt ?? null,
      document: {
        title: '계약서',
        pageCount: 2,
        status: opts.documentStatus,
        storageKey: STORAGE_KEY,
        signedStorageKey: opts.signedStorageKey ?? null,
        owner: { name: '보내는 사람', brandColor: null, brandLogoUrl: null },
      },
    };
    const prisma = { signRequest: { findUnique: jest.fn().mockResolvedValue(row) } };
    const storage = { read: jest.fn(async () => Buffer.from('%PDF-1.7 fake')) };
    const clauseExtraction = {
      extractFromPdf: jest.fn(opts.extract ?? (async () => CLAUSES)),
    };
    const service = new SigningService(
      prisma as never,
      storage as never,
      { issue: jest.fn() } as never,
      { enqueue: jest.fn() } as never,
      clauseExtraction as never,
    );
    return { service, storage, clauseExtraction };
  }

  it('meta() projects re-entry facts + documentReady once SIGNED and COMPLETED', async () => {
    const signedAt = new Date('2026-08-11T05:06:07.000Z');
    const { service, clauseExtraction } = buildForMeta({
      status: SignRequestStatus.SIGNED,
      documentStatus: DocumentStatus.COMPLETED,
      signedStorageKey: SIGNED_KEY,
      signedAt,
    });

    const meta = await service.meta('tok');

    expect(meta.alreadySigned).toBe(true);
    expect(meta.signedAt).toBe(signedAt.toISOString());
    expect(meta.contractDate).toBe('2026년 8월 11일');
    expect(meta.contractAmount).toBe('1,200만원');
    expect(meta.documentReady).toBe(true);
    expect(clauseExtraction.extractFromPdf).toHaveBeenCalledTimes(1);
  });

  it('meta() reports documentReady=false while the final PDF is still processing', async () => {
    const { service } = buildForMeta({
      status: SignRequestStatus.SIGNED,
      documentStatus: DocumentStatus.IN_PROGRESS, // not the last signer yet
      signedStorageKey: null,
      signedAt: new Date('2026-08-11T05:06:07.000Z'),
    });
    const meta = await service.meta('tok');
    expect(meta.documentReady).toBe(false);
  });

  it('meta() reports documentReady=false when COMPLETED but no signed PDF stored yet', async () => {
    const { service } = buildForMeta({
      status: SignRequestStatus.SIGNED,
      documentStatus: DocumentStatus.COMPLETED,
      signedStorageKey: null,
      signedAt: new Date('2026-08-11T05:06:07.000Z'),
    });
    const meta = await service.meta('tok');
    expect(meta.documentReady).toBe(false);
  });

  it('meta() leaves facts null and skips extraction before signing', async () => {
    const { service, clauseExtraction } = buildForMeta({
      status: SignRequestStatus.VIEWED,
      documentStatus: DocumentStatus.IN_PROGRESS,
    });
    const meta = await service.meta('tok');

    expect(meta.alreadySigned).toBe(false);
    expect(meta.signedAt).toBeNull();
    expect(meta.contractDate).toBeNull();
    expect(meta.contractAmount).toBeNull();
    expect(meta.documentReady).toBe(false);
    // No pre-auth PDF read before the signer has actually signed.
    expect(clauseExtraction.extractFromPdf).not.toHaveBeenCalled();
  });
});
