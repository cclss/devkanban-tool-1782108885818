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
});
