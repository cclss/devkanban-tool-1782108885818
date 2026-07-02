import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { promisify } from 'util';
import { MESSAGES } from '../common/messages';

/**
 * Server-side DOCX → PDF conversion.
 *
 * Uploads accept two source formats (PDF, DOCX) but everything downstream —
 * render, analysis, signing, final export — consumes a single **canonical PDF**
 * so the bytes the canvas renders and the coordinates the analyzer produces stay
 * in the same space. This service turns DOCX bytes into that canonical PDF by
 * driving a headless LibreOffice (`soffice`) through `libreoffice-convert`.
 *
 * It is intentionally pure (bytes → bytes) and never touches storage or the DB.
 * Any failure — the `soffice` binary missing, a corrupt/locked document, an
 * empty result — is collapsed into a single user-facing Korean error
 * (`MESSAGES.document.conversionFailed`); the internal cause is logged, never
 * surfaced. Callers rethrow it as a clean 4xx so a conversion problem degrades
 * the one upload instead of crashing the process.
 */

/** Callback-style signature of `libreoffice-convert`'s `convert`. */
type LibreConvert = (
  input: Buffer,
  outputExt: string,
  filter: string | undefined,
  callback: (err: Error | null, done: Buffer) => void,
) => void;

type ConvertAsync = (input: Buffer, outputExt: string, filter: string | undefined) => Promise<Buffer>;

// Resolve `libreoffice-convert` through a *native* dynamic import so TypeScript
// never tries to type-check (or a bundler to statically resolve) the module — it
// may be absent in a given environment, in which case the load fails *gracefully*
// at call time rather than breaking compilation. The Function wrapper preserves a
// native `import()` (rather than letting tsc down-level it to `require`), which
// resolves both under the CommonJS runtime and the ESM VM used by tests. Mirrors
// the escape hatch used for pdfjs in `document-extraction.service.ts`.
const nativeImport = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<unknown>;

@Injectable()
export class DocxToPdfService {
  private readonly logger = new Logger(DocxToPdfService.name);
  private convertAsync: ConvertAsync | null = null;

  /**
   * Convert DOCX bytes into canonical PDF bytes. Rejects with a
   * `BadRequestException` carrying the Korean conversion-failure copy on any
   * failure (missing/failed `soffice`, unreadable document, empty output).
   */
  async convert(docx: Buffer): Promise<Buffer> {
    const convert = await this.loadConverter();
    try {
      const pdf = await convert(docx, '.pdf', undefined);
      if (!pdf || pdf.length === 0) {
        throw new Error('빈 변환 결과');
      }
      return pdf;
    } catch (err) {
      // Do not leak the internal cause (soffice stderr, etc.) to the user.
      this.logger.warn(`DOCX→PDF 변환 실패: ${String(err)}`);
      throw new BadRequestException(MESSAGES.document.conversionFailed);
    }
  }

  /** Lazily load + promisify `libreoffice-convert`; memoized after first use. */
  private async loadConverter(): Promise<ConvertAsync> {
    if (this.convertAsync) return this.convertAsync;
    try {
      const mod = (await nativeImport('libreoffice-convert')) as {
        convert?: LibreConvert;
        default?: { convert?: LibreConvert };
      };
      const raw = mod.convert ?? mod.default?.convert;
      if (typeof raw !== 'function') {
        throw new Error('libreoffice-convert.convert 를 찾을 수 없음');
      }
      this.convertAsync = promisify(raw) as ConvertAsync;
      return this.convertAsync;
    } catch (err) {
      this.logger.error(`libreoffice-convert 로드 실패: ${String(err)}`);
      throw new BadRequestException(MESSAGES.document.conversionFailed);
    }
  }
}
