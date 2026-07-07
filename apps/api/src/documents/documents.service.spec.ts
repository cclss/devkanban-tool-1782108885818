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
