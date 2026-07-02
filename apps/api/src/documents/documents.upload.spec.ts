import { BadRequestException } from '@nestjs/common';
import { DocumentFormat, DocumentStatus } from '@repo/db';
import { DocumentsService } from './documents.service';
import { PDF_MIME, DOCX_MIME } from './document-format';

/**
 * uploadAndCreate() DOCX→PDF integration: DOCX uploads are converted to a
 * canonical PDF (original preserved), PDF uploads pass through unchanged, and a
 * conversion failure surfaces as a friendly 4xx without crashing.
 */
describe('DocumentsService.uploadAndCreate — DOCX→PDF conversion', () => {
  const OWNER = 'owner-1';

  function makeService(opts: { convert?: () => Promise<Buffer> } = {}) {
    const saved: Array<{ key: string; bytes: Buffer }> = [];
    const storage = {
      buildKey: (ownerId: string, name: string) => `key/${ownerId}/${name}`,
      save: jest.fn(async (key: string, bytes: Buffer) => {
        saved.push({ key, bytes });
      }),
    };
    const convert = jest.fn(opts.convert ?? (async () => Buffer.from('%PDF-converted')));
    const docxToPdf = { convert };
    const countPages = jest.fn(async () => 3);
    const extraction = { countPages };
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      document: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return {
            id: 'doc-1',
            status: DocumentStatus.DRAFT,
            sentAt: null,
            completedAt: null,
            signedStorageKey: null,
            certificateStorageKey: null,
            createdAt: new Date('2026-07-02T00:00:00Z'),
            ...data,
          };
        }),
      },
      auditLog: { create: jest.fn(async () => undefined) },
    };
    const service = new DocumentsService(
      prisma as never,
      storage as never,
      {} as never,
      {} as never,
      extraction as never,
      {} as never,
      docxToPdf as never,
    );
    return { service, storage, convert, countPages, prisma, saved, created };
  }

  function pdfFile() {
    return {
      originalname: 'contract.pdf',
      mimetype: PDF_MIME,
      buffer: Buffer.from('%PDF-1.7 original'),
      size: 17,
    };
  }

  function docxFile() {
    // PK\x03\x04 ZIP magic so detection classifies it as DOCX.
    return {
      originalname: 'contract.docx',
      mimetype: DOCX_MIME,
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]),
      size: 6,
    };
  }

  it('stores a PDF upload unchanged and never invokes the converter', async () => {
    const { service, convert, countPages, created } = makeService();

    await service.uploadAndCreate(OWNER, pdfFile());

    expect(convert).not.toHaveBeenCalled();
    // Page count is taken against the (PDF) canonical bytes.
    expect(countPages).toHaveBeenCalledWith(expect.any(Buffer), DocumentFormat.PDF);
    const data = created[0];
    expect(data.format).toBe(DocumentFormat.PDF);
    expect(data.sourceFormat).toBe(DocumentFormat.PDF);
    expect(data.sourceStorageKey).toBeNull();
    expect(data.mimeType).toBe(PDF_MIME);
    expect(String(data.storageKey)).toContain('contract.pdf');
  });

  it('converts a DOCX to canonical PDF, preserves the original, and records source metadata', async () => {
    const { service, convert, countPages, created, saved } = makeService();

    const summary = await service.uploadAndCreate(OWNER, docxFile());

    expect(convert).toHaveBeenCalledTimes(1);
    // Analysis/page-count run on the converted PDF, not the DOCX bytes.
    expect(countPages).toHaveBeenCalledWith(Buffer.from('%PDF-converted'), DocumentFormat.PDF);
    expect(summary.pageCount).toBe(3);

    const data = created[0];
    expect(data.format).toBe(DocumentFormat.PDF);
    expect(data.sourceFormat).toBe(DocumentFormat.DOCX);
    expect(data.mimeType).toBe(PDF_MIME);
    // Canonical key is a .pdf; original DOCX preserved under a distinct key.
    expect(String(data.storageKey)).toContain('contract.pdf');
    expect(data.sourceStorageKey).toBeTruthy();
    expect(String(data.sourceStorageKey)).toContain('contract.docx');

    // Both the original DOCX and the converted PDF were written to storage.
    const keys = saved.map((s) => s.key);
    expect(keys.some((k) => k.includes('contract.docx'))).toBe(true);
    expect(keys.some((k) => k.includes('contract.pdf'))).toBe(true);
  });

  it('surfaces a conversion failure as a friendly 4xx and creates no document', async () => {
    const { service, prisma } = makeService({
      convert: async () => {
        throw new BadRequestException('DOCX 문서를 PDF로 변환하지 못했어요.');
      },
    });

    await expect(service.uploadAndCreate(OWNER, docxFile())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.document.create).not.toHaveBeenCalled();
  });
});
