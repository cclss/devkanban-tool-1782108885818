import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { DocumentsService } from './documents.service';
import { MESSAGES } from '../common/messages';

/**
 * Focused unit tests for the multipart upload entry point `uploadAndCreate`,
 * exercising the PDF/DOCX detection + DOCX→PDF conversion routing added in this
 * grain. Collaborators (Prisma, storage, notifications, quota, conversion) are
 * faked so only the routing/normalization policy is under test.
 */

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A structurally valid, single-page PDF that pdf-lib can load. */
async function makePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage();
  return Buffer.from(await doc.save());
}

/** Assemble a DocumentsService with fakes; returns it plus the fakes to assert on. */
function makeService(convertedPdf: Buffer) {
  const created: any[] = [];
  const prisma = {
    document: {
      create: jest.fn(async ({ data }: any) => {
        const doc = {
          id: 'doc-1',
          status: 'DRAFT',
          sentAt: null,
          createdAt: new Date('2026-07-07T00:00:00Z'),
          completedAt: null,
          signedStorageKey: null,
          certificateStorageKey: null,
          ...data,
        };
        created.push(doc);
        return doc;
      }),
    },
    auditLog: { create: jest.fn(async () => undefined) },
  };
  const storage = {
    buildKey: jest.fn((ownerId: string, name: string) => `documents/${ownerId}/${name}`),
    save: jest.fn(async () => undefined),
  };
  const notifications = {};
  const config = { get: () => undefined };
  const sendQuota = {};
  const conversion = { docxToPdf: jest.fn(async () => convertedPdf) };

  const service = new DocumentsService(
    prisma as any,
    storage as any,
    notifications as any,
    config as any,
    sendQuota as any,
    conversion as any,
  );
  return { service, prisma, storage, conversion };
}

describe('DocumentsService.uploadAndCreate — PDF/DOCX routing', () => {
  it('stores a native PDF as-is without invoking conversion', async () => {
    const pdf = await makePdf();
    const { service, storage, conversion } = makeService(pdf);

    const summary = await service.uploadAndCreate('user-1', {
      originalname: 'contract.pdf',
      mimetype: 'application/pdf',
      buffer: pdf,
      size: pdf.length,
    });

    expect(conversion.docxToPdf).not.toHaveBeenCalled();
    expect(storage.save).toHaveBeenCalledWith(expect.any(String), pdf);
    expect(summary.pageCount).toBe(1);
    expect(summary.title).toBe('contract');
  });

  it('converts a DOCX and persists the converted PDF as the source of truth', async () => {
    const pdf = await makePdf();
    const docx = Buffer.concat([Buffer.from('PK'), Buffer.from('\x03\x04 fake docx')]);
    const { service, storage, conversion } = makeService(pdf);

    const summary = await service.uploadAndCreate('user-1', {
      originalname: '한글계약서.docx',
      mimetype: DOCX_MIME,
      buffer: docx,
      size: docx.length,
    });

    // Conversion ran on the original DOCX bytes...
    expect(conversion.docxToPdf).toHaveBeenCalledWith(docx);
    // ...and everything downstream describes the converted PDF, not the DOCX.
    expect(storage.save).toHaveBeenCalledWith(expect.any(String), pdf);
    const [, storedName] = (storage.buildKey as jest.Mock).mock.calls[0];
    expect(storedName).toBe('한글계약서.pdf'); // stored key reflects PDF contents
    expect(summary.pageCount).toBe(1); // computed from the converted PDF
    expect(summary.title).toBe('한글계약서'); // extension stripped
  });

  it('accepts a DOCX detected by extension even when the MIME is generic', async () => {
    const pdf = await makePdf();
    const docx = Buffer.from('PK\x03\x04 zip-ish');
    const { service, conversion } = makeService(pdf);

    await service.uploadAndCreate('user-1', {
      originalname: 'agreement.docx',
      mimetype: 'application/octet-stream',
      buffer: docx,
      size: docx.length,
    });

    expect(conversion.docxToPdf).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsupported file type with invalidFileType, without converting', async () => {
    const pdf = await makePdf();
    const junk = Buffer.from('this is plain text, not a document');
    const { service, conversion } = makeService(pdf);

    await expect(
      service.uploadAndCreate('user-1', {
        originalname: 'notes.txt',
        mimetype: 'text/plain',
        buffer: junk,
        size: junk.length,
      }),
    ).rejects.toThrow(MESSAGES.document.invalidFileType);
    expect(conversion.docxToPdf).not.toHaveBeenCalled();
  });

  it('rejects a .docx name whose bytes are not a ZIP (no PK magic)', async () => {
    const pdf = await makePdf();
    const notZip = Buffer.from('%PDF- pretending, wrong container');
    const { service } = makeService(pdf);

    await expect(
      service.uploadAndCreate('user-1', {
        originalname: 'fake.docx',
        mimetype: DOCX_MIME,
        buffer: notZip,
        size: notZip.length,
      }),
    ).rejects.toThrow(MESSAGES.document.invalidFileType);
  });

  it('propagates conversionFailed when a corrupt DOCX fails to convert', async () => {
    const pdf = await makePdf();
    const docx = Buffer.from('PK\x03\x04 corrupt');
    const { service, conversion } = makeService(pdf);
    conversion.docxToPdf.mockRejectedValueOnce(
      new BadRequestException(MESSAGES.document.conversionFailed),
    );

    await expect(
      service.uploadAndCreate('user-1', {
        originalname: 'broken.docx',
        mimetype: DOCX_MIME,
        buffer: docx,
        size: docx.length,
      }),
    ).rejects.toThrow(MESSAGES.document.conversionFailed);
  });
});
