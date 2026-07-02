import { BadRequestException } from '@nestjs/common';
import { DocxToPdfService } from './docx-to-pdf.service';
import { MESSAGES } from '../common/messages';

/**
 * The converter collapses every failure mode — a corrupt/locked document, an
 * empty result, the underlying engine failing — into a single user-facing Korean
 * error, never leaking the internal cause; a successful conversion passes the
 * PDF bytes straight through.
 *
 * The memoized `convertAsync` field is pre-seeded so these tests exercise the
 * error-mapping contract deterministically, without spawning the real (env-
 * dependent) `soffice`/`libreoffice-convert` loader.
 */
describe('DocxToPdfService', () => {
  type Seam = { convertAsync: (b: Buffer, ext: string, filter?: string) => Promise<Buffer> };

  function withConverter(fn: () => Promise<Buffer>): DocxToPdfService {
    const service = new DocxToPdfService();
    (service as unknown as Seam).convertAsync = fn;
    return service;
  }

  it('maps an underlying conversion failure to the friendly Korean error', async () => {
    const service = withConverter(async () => {
      throw new Error('soffice: command not found'); // internal cause — must not leak
    });

    await expect(service.convert(Buffer.from('docx'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.convert(Buffer.from('docx'))).rejects.toThrow(
      MESSAGES.document.conversionFailed,
    );
  });

  it('treats an empty conversion result as a failure', async () => {
    const service = withConverter(async () => Buffer.alloc(0));

    await expect(service.convert(Buffer.from('docx'))).rejects.toThrow(
      MESSAGES.document.conversionFailed,
    );
  });

  it('returns the converted PDF bytes on success', async () => {
    const pdf = Buffer.from('%PDF-ok');
    const service = withConverter(async () => pdf);

    await expect(service.convert(Buffer.from('docx'))).resolves.toBe(pdf);
  });
});
