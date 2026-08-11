import { DocumentStatus, SignRequestStatus } from '@repo/db';
import { SigningService } from './signing.service';
import type { ExtractedClause } from '../pdf/clause-extraction.types';

/**
 * grain-2: `SigningService.payload()` wires the extracted "핵심 조항" cards onto
 * the payload — on-demand, and never fatal.
 *
 *  • an extractable document → payload carries its clauses;
 *  • extraction returning 0 cards        → `clauses: []`;
 *  • extraction throwing (corrupt PDF)   → `clauses: []` (no error bubbles up);
 *  • the PDF read itself throwing        → `clauses: []` (storage hiccup absorbed).
 *
 * In every failure case the rest of the payload (title/fields/pdfPath) is still
 * well-formed, so the signer flow degrades to the original view with no error
 * screen (spec §2 폴백).
 */
describe('SigningService — payload clause wiring (grain-2)', () => {
  const SR_ID = 'sr_clauses';
  const STORAGE_KEY = 'documents/owner/doc.pdf';

  const sampleClauses: ExtractedClause[] = [
    {
      title: '제3조 (계약기간)',
      plainText: '이 계약은 1년간 유효합니다.',
      figures: [{ kind: 'period', value: '1년' }],
      caution: false,
      page: 1,
    },
  ];

  function build(opts: {
    extract?: () => Promise<ExtractedClause[]>;
    read?: () => Promise<Buffer>;
  }) {
    const row = {
      id: SR_ID,
      accessToken: 'tok_ip',
      status: SignRequestStatus.VIEWED,
      document: {
        id: 'doc_1',
        title: '계약서',
        pageCount: 3,
        status: DocumentStatus.IN_PROGRESS,
        storageKey: STORAGE_KEY,
      },
      signFields: [
        { id: 'f1', type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, value: null },
      ],
    };
    const prisma = {
      signRequest: { findUnique: jest.fn().mockResolvedValue(row) },
      auditLog: { count: jest.fn().mockResolvedValue(1), create: jest.fn().mockResolvedValue({}) },
    };
    const storage = {
      read: jest.fn(opts.read ?? (async () => Buffer.from('%PDF-1.7 fake'))),
    };
    const clauseExtraction = {
      extractFromPdf: jest.fn(opts.extract ?? (async () => [])),
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

  it('attaches extracted clauses for a document with usable text', async () => {
    const { service, storage, clauseExtraction } = build({
      extract: async () => sampleClauses,
    });

    const payload = await service.payload(SR_ID);

    expect(storage.read).toHaveBeenCalledWith(STORAGE_KEY);
    expect(clauseExtraction.extractFromPdf).toHaveBeenCalledTimes(1);
    expect(payload.clauses).toEqual(sampleClauses);
    // Rest of the payload is intact.
    expect(payload.documentTitle).toBe('계약서');
    expect(payload.fields).toHaveLength(1);
  });

  it('returns clauses: [] when the extractor finds no cards', async () => {
    const { service } = build({ extract: async () => [] });
    const payload = await service.payload(SR_ID);
    expect(payload.clauses).toEqual([]);
    expect(payload.fields).toHaveLength(1);
  });

  it('returns clauses: [] (no throw) when extraction fails', async () => {
    const { service } = build({
      extract: async () => {
        throw new Error('corrupt PDF');
      },
    });
    await expect(service.payload(SR_ID)).resolves.toMatchObject({ clauses: [] });
  });

  it('returns clauses: [] (no throw) when the PDF read fails', async () => {
    const { service, clauseExtraction } = build({
      read: async () => {
        throw new Error('storage unavailable');
      },
    });
    const payload = await service.payload(SR_ID);
    expect(payload.clauses).toEqual([]);
    // Extraction is never attempted when the bytes can't be read.
    expect(clauseExtraction.extractFromPdf).not.toHaveBeenCalled();
    // Payload still well-formed.
    expect(payload.pdfPath).toContain('/pdf');
  });
});
