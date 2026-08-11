import { DocumentStatus, SignRequestStatus } from '@repo/db';
import { SigningService } from './signing.service';

/**
 * grain-1 (spec §5 / M-6): `SigningService.payload()` projects each field's
 * actual stored value onto the payload for session re-entry restore.
 *
 *  • a filled field → `value` carries the real stored string, `filled: true`;
 *  • an unfilled field → `value: null`, `filled: false`.
 *
 * This lets the frontend render the previously captured value on re-entry
 * instead of a "작성됨" placeholder.
 */
describe('SigningService — payload field value projection (grain-1)', () => {
  const SR_ID = 'sr_values';
  const STORAGE_KEY = 'documents/owner/doc.pdf';
  const SIGNATURE_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  function build(
    signFields: Array<{
      id: string;
      type: string;
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      value: string | null;
    }>,
  ) {
    const row = {
      id: SR_ID,
      accessToken: 'tok_values',
      status: SignRequestStatus.VIEWED,
      document: {
        id: 'doc_1',
        title: '계약서',
        pageCount: 3,
        status: DocumentStatus.IN_PROGRESS,
        storageKey: STORAGE_KEY,
      },
      signFields,
    };
    const prisma = {
      signRequest: { findUnique: jest.fn().mockResolvedValue(row) },
      auditLog: { count: jest.fn().mockResolvedValue(1), create: jest.fn().mockResolvedValue({}) },
    };
    const storage = { read: jest.fn(async () => Buffer.from('%PDF-1.7 fake')) };
    const clauseExtraction = { extractFromPdf: jest.fn(async () => []) };
    const service = new SigningService(
      prisma as never,
      storage as never,
      { issue: jest.fn() } as never,
      { enqueue: jest.fn() } as never,
      clauseExtraction as never,
    );
    return { service };
  }

  it('projects the actual stored value for filled fields (all types)', async () => {
    const { service } = build([
      { id: 'sig', type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.08, value: SIGNATURE_DATA_URL },
      { id: 'txt', type: 'TEXT', page: 1, x: 0.1, y: 0.3, width: 0.3, height: 0.05, value: '홍길동' },
      { id: 'dat', type: 'DATE', page: 2, x: 0.1, y: 0.5, width: 0.3, height: 0.05, value: '2026-08-11' },
    ]);

    const payload = await service.payload(SR_ID);
    const byId = Object.fromEntries(payload.fields.map((f) => [f.id, f]));

    expect(byId.sig).toMatchObject({ filled: true, value: SIGNATURE_DATA_URL });
    expect(byId.txt).toMatchObject({ filled: true, value: '홍길동' });
    expect(byId.dat).toMatchObject({ filled: true, value: '2026-08-11' });
  });

  it('returns value: null for unfilled fields', async () => {
    const { service } = build([
      { id: 'empty', type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.08, value: null },
      { id: 'blank', type: 'TEXT', page: 1, x: 0.1, y: 0.3, width: 0.3, height: 0.05, value: '' },
    ]);

    const payload = await service.payload(SR_ID);
    const byId = Object.fromEntries(payload.fields.map((f) => [f.id, f]));

    expect(byId.empty).toMatchObject({ filled: false, value: null });
    expect(byId.blank).toMatchObject({ filled: false, value: null });
  });
});
