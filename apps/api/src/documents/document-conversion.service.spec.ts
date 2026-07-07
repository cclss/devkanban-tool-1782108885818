import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  DocumentConversionService,
  type LibreOfficeConvert,
} from './document-conversion.service';
import { MESSAGES } from '../common/messages';

/** Minimal ConfigService stub returning the given env values (else undefined). */
function makeConfig(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** Bytes that pass the `%PDF-` output check. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
/** Stand-in DOCX bytes (a real .docx is a ZIP starting with `PK`). */
const DOCX = Buffer.from('PK fake docx bytes');

describe('DocumentConversionService', () => {
  it('returns the converted PDF buffer for a valid DOCX', async () => {
    const convert: LibreOfficeConvert = async (input, ext) => {
      expect(input).toBe(DOCX);
      expect(ext).toBe('.pdf'); // always targets PDF
      return PDF;
    };
    const service = new DocumentConversionService(makeConfig(), convert);

    const out = await service.docxToPdf(DOCX);

    expect(out.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('throws conversionFailed when the converter rejects (corrupt/unsupported file)', async () => {
    const convert: LibreOfficeConvert = async () => {
      throw new Error('source file could not be loaded');
    };
    const service = new DocumentConversionService(makeConfig(), convert);

    await expect(service.docxToPdf(DOCX)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.docxToPdf(DOCX)).rejects.toThrow(MESSAGES.document.conversionFailed);
  });

  it('throws conversionFailed on empty input without invoking soffice', async () => {
    const convert = jest.fn<Promise<Buffer>, [Buffer, string]>();
    const service = new DocumentConversionService(makeConfig(), convert);

    await expect(service.docxToPdf(Buffer.alloc(0))).rejects.toThrow(
      MESSAGES.document.conversionFailed,
    );
    expect(convert).not.toHaveBeenCalled();
  });

  it('throws conversionFailed when soffice returns non-PDF bytes', async () => {
    const convert: LibreOfficeConvert = async () => Buffer.from('not a pdf at all');
    const service = new DocumentConversionService(makeConfig(), convert);

    await expect(service.docxToPdf(DOCX)).rejects.toThrow(MESSAGES.document.conversionFailed);
  });

  it('throws conversionFailed when a conversion exceeds the timeout', async () => {
    // Converter that never settles — only the timeout can resolve the race.
    const convert: LibreOfficeConvert = () => new Promise<Buffer>(() => undefined);
    const service = new DocumentConversionService(
      makeConfig({ DOCX_CONVERT_TIMEOUT_MS: '20' }),
      convert,
    );

    await expect(service.docxToPdf(DOCX)).rejects.toThrow(MESSAGES.document.conversionFailed);
  });

  it('never runs more than the configured max concurrent conversions', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const convert: LibreOfficeConvert = () =>
      new Promise<Buffer>((resolve) => {
        active += 1;
        peak = Math.max(peak, active);
        releases.push(() => {
          active -= 1;
          resolve(PDF);
        });
      });
    const service = new DocumentConversionService(
      makeConfig({ DOCX_CONVERT_CONCURRENCY: '2' }),
      convert,
    );

    const all = Promise.all(Array.from({ length: 5 }, () => service.docxToPdf(DOCX)));

    // Repeatedly let queued conversions start, then release everything running.
    for (let i = 0; i < 6; i += 1) {
      await new Promise((r) => setImmediate(r));
      releases.splice(0).forEach((fn) => fn());
    }

    await all;
    expect(peak).toBe(2); // the 3rd–5th waited for a slot
  });
});
