import { DocumentFormat } from '@repo/db';
import {
  DOCX_MIME,
  PDF_MIME,
  detectDocumentFormat,
} from './document-format';

const pdfBytes = Buffer.from('%PDF-1.7\n...rest');
const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const junkBytes = Buffer.from('just some text');

describe('detectDocumentFormat — with bytes (upload path)', () => {
  it('accepts a PDF by MIME + magic', () => {
    expect(detectDocumentFormat({ mimeType: PDF_MIME, fileName: 'a.pdf', buffer: pdfBytes })).toEqual(
      { format: DocumentFormat.PDF, mimeType: PDF_MIME },
    );
  });

  it('accepts a DOCX by MIME + ZIP magic', () => {
    expect(
      detectDocumentFormat({ mimeType: DOCX_MIME, fileName: 'a.docx', buffer: zipBytes }),
    ).toEqual({ format: DocumentFormat.DOCX, mimeType: DOCX_MIME });
  });

  it('accepts a DOCX by extension + ZIP magic even with a generic MIME', () => {
    expect(
      detectDocumentFormat({
        mimeType: 'application/octet-stream',
        fileName: 'contract.docx',
        buffer: zipBytes,
      }),
    ).toEqual({ format: DocumentFormat.DOCX, mimeType: DOCX_MIME });
  });

  it('rejects a .pdf name whose bytes are not a PDF', () => {
    expect(detectDocumentFormat({ mimeType: PDF_MIME, fileName: 'a.pdf', buffer: junkBytes })).toBeNull();
  });

  it('rejects a .docx name whose bytes are not a ZIP', () => {
    expect(
      detectDocumentFormat({ mimeType: DOCX_MIME, fileName: 'a.docx', buffer: junkBytes }),
    ).toBeNull();
  });

  it('disambiguates a docx served with a bogus pdf MIME using magic bytes', () => {
    expect(
      detectDocumentFormat({ mimeType: PDF_MIME, fileName: 'a.docx', buffer: zipBytes }),
    ).toEqual({ format: DocumentFormat.DOCX, mimeType: DOCX_MIME });
  });

  it('rejects an unsupported type', () => {
    expect(
      detectDocumentFormat({ mimeType: 'image/png', fileName: 'a.png', buffer: zipBytes }),
    ).toBeNull();
  });
});

describe('detectDocumentFormat — without bytes (register-by-key path)', () => {
  it('infers PDF from a .pdf key', () => {
    expect(detectDocumentFormat({ fileName: 'documents/u/x.pdf' })).toEqual({
      format: DocumentFormat.PDF,
      mimeType: PDF_MIME,
    });
  });

  it('infers DOCX from a .docx key', () => {
    expect(detectDocumentFormat({ fileName: 'documents/u/x.docx' })).toEqual({
      format: DocumentFormat.DOCX,
      mimeType: DOCX_MIME,
    });
  });

  it('returns null for an unknown extension', () => {
    expect(detectDocumentFormat({ fileName: 'documents/u/x.txt' })).toBeNull();
  });
});
