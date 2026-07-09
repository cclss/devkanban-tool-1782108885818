import 'reflect-metadata';
import { DocumentStatus } from '@repo/db';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { MIN_NORM_HEIGHT, MIN_NORM_WIDTH } from '@repo/field-geometry';
import { DocumentsService } from './documents.service';
import { SignFieldDto, SignFieldTypeDto } from './dto/documents.dto';
import {
  extractPdfTextLayer,
  type PdfTextLayer,
} from './field-suggestions/pdf-text-extraction';

// Mock only the pdf.js-backed extraction boundary (IO/parse). The pure engine
// (`suggestSignFields`) stays REAL, so a fixture text layer is mapped to actual,
// contract-valid `SignFieldDto[]` by production code — we stub the byte→layer
// parse, not the placement logic. This also keeps this service unit test from
// loading pdf.js (its ESM import + the extraction/engine specs already cover the
// real PDF→layer path end-to-end in grain-2/grain-4).
jest.mock('./field-suggestions/pdf-text-extraction', () => ({
  extractPdfTextLayer: jest.fn(),
}));
const mockExtract = extractPdfTextLayer as jest.MockedFunction<typeof extractPdfTextLayer>;

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

/**
 * Unit tests for `suggestFields` — the M2 grain-1 service method that returns the
 * text-heuristic AI auto-placement drafts (`SignFieldDto[]`).
 *
 * The method wires together an ownership guard, a storage read, and the pure
 * extraction+engine pipeline. These tests pin that wiring and — most importantly
 * — the **response contract** recorded for the suggestion API: a best-effort
 * assist that never blocks the wizard.
 *   1. text-layer PDF  → a valid, contract-conformant `SignFieldDto[]`
 *   2. scanned PDF (no text layer) → `[]` (engine's natural fallback)
 *   3. corrupt/unparseable PDF     → `[]` (failure swallowed + logged, NOT thrown)
 *   4. non-owner                   → `ForbiddenException` (guard propagates)
 *   5. missing document            → `NotFoundException` (guard propagates)
 *
 * Only the pdf.js parse boundary (`extractPdfTextLayer`) is mocked; the REAL
 * engine (`suggestSignFields`) maps the fixture text layer, so cases 1–2 exercise
 * production placement logic. The real PDF→text-layer parse is covered end-to-end
 * by the grain-2 extraction spec and the grain-4 engine spec.
 */
describe('DocumentsService.suggestFields — AI field-suggestion drafts', () => {
  let service: DocumentsService;
  let prisma: { document: { findUnique: jest.Mock } };
  let storage: { read: jest.Mock };

  /**
   * A text layer holding SIGNATURE / DATE / TEXT anchors on an A4-ish page. This
   * is exactly what the grain-2 extractor returns; the real engine maps it to a
   * draft `SignFieldDto[]`. bbox coords are PDF page space (bottom-left origin).
   */
  const textLayer: PdfTextLayer = {
    hasTextLayer: true,
    pages: [
      {
        page: 1,
        width: 595,
        height: 842,
        rotation: 0,
        fragments: [
          { text: '서명:', bbox: { x: 90, y: 700, width: 40, height: 13 } }, // SIGNATURE
          { text: '날짜:', bbox: { x: 90, y: 640, width: 40, height: 13 } }, // DATE
          { text: '이름:', bbox: { x: 90, y: 580, width: 40, height: 13 } }, // TEXT
        ],
      },
    ],
  };

  /** A scanned / image-only PDF's layer: a page but no text fragments. */
  const scannedLayer: PdfTextLayer = {
    hasTextLayer: false,
    pages: [{ page: 1, width: 595, height: 842, rotation: 0, fragments: [] }],
  };

  beforeEach(() => {
    mockExtract.mockReset();
    prisma = { document: { findUnique: jest.fn() } };
    storage = { read: jest.fn() };
    service = new DocumentsService(
      prisma as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  /** A persisted document row owned by `ownerId` at a known storage key. */
  function ownedDocument(ownerId: string, storageKey = 'documents/owner-1/abc.pdf') {
    return { id: 'doc-1', ownerId, storageKey, status: DocumentStatus.DRAFT };
  }

  /** Assert one suggested field satisfies the full `SignFieldDto` output contract. */
  function expectValidSignField(field: SignFieldDto): void {
    expect(Object.values(SignFieldTypeDto)).toContain(field.type);
    expect(Number.isInteger(field.page)).toBe(true);
    expect(field.page).toBeGreaterThanOrEqual(1);
    for (const v of [field.x, field.y, field.width, field.height]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Bottom-left origin + span stays inside the page (clampNormRect).
    expect(field.x + field.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(field.y + field.height).toBeLessThanOrEqual(1 + 1e-9);
    // Never smaller than the minimum grabbable footprint.
    expect(field.width).toBeGreaterThanOrEqual(MIN_NORM_WIDTH - 1e-9);
    expect(field.height).toBeGreaterThanOrEqual(MIN_NORM_HEIGHT - 1e-9);
    // Single-signer constraint (기획 확정 제약).
    expect(field.recipientIndex).toBe(0);
  }

  it('returns a valid SignFieldDto[] for a text-layer PDF', async () => {
    prisma.document.findUnique.mockResolvedValue(ownedDocument('owner-1'));
    storage.read.mockResolvedValue(Buffer.from('%PDF- (bytes are parsed by the mock)'));
    mockExtract.mockResolvedValue(textLayer);

    const fields = await service.suggestFields('owner-1', 'doc-1');

    // The real engine turned the anchors into draft fields; each conforms to the
    // output contract.
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) expectValidSignField(field);

    // The bytes were read from the owned document's storage key and handed to the
    // extractor.
    expect(storage.read).toHaveBeenCalledWith('documents/owner-1/abc.pdf');
    expect(mockExtract).toHaveBeenCalledTimes(1);

    // All three anchor types were suggested from the contract's labels.
    const types = new Set(fields.map((f) => f.type));
    expect(types).toContain(SignFieldTypeDto.SIGNATURE);
    expect(types).toContain(SignFieldTypeDto.DATE);
    expect(types).toContain(SignFieldTypeDto.TEXT);
  });

  it('returns an empty array for a scanned PDF with no text layer', async () => {
    prisma.document.findUnique.mockResolvedValue(ownedDocument('owner-1'));
    storage.read.mockResolvedValue(Buffer.from('scanned-image-pdf'));
    mockExtract.mockResolvedValue(scannedLayer);

    // Manual-placement fallback: the engine finds no text layer → [].
    await expect(service.suggestFields('owner-1', 'doc-1')).resolves.toEqual([]);
  });

  it('returns an empty array (not an exception) for a corrupt/unparseable PDF', async () => {
    prisma.document.findUnique.mockResolvedValue(ownedDocument('owner-1'));
    storage.read.mockResolvedValue(Buffer.from('this is not a pdf'));
    // A corrupt PDF makes the extractor throw; the service must swallow it into [].
    mockExtract.mockRejectedValue(new Error('Invalid PDF structure'));
    const warnSpy = jest
      .spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    await expect(service.suggestFields('owner-1', 'doc-1')).resolves.toEqual([]);
    // The failure was logged, not surfaced to the caller.
    expect(warnSpy).toHaveBeenCalled();
  });

  it('throws ForbiddenException when the requester does not own the document', async () => {
    prisma.document.findUnique.mockResolvedValue(ownedDocument('someone-else'));

    await expect(service.suggestFields('owner-1', 'doc-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // The guard rejects before any bytes are read or parsed.
    expect(storage.read).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the document does not exist', async () => {
    prisma.document.findUnique.mockResolvedValue(null);

    await expect(service.suggestFields('owner-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.read).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
  });
});
