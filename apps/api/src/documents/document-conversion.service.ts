import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MESSAGES } from '../common/messages';

/**
 * DI token for the low-level LibreOffice (`soffice`) convert function.
 *
 * `DocumentsModule` binds the real `libreoffice-convert`-backed implementation
 * (see `libreoffice-convert.provider.ts`); unit tests bind a fake so the
 * conversion *policy* here — timeout, concurrency, output validation, failure
 * translation — can be exercised without the native soffice binary installed.
 */
export const LIBREOFFICE_CONVERT = Symbol('LIBREOFFICE_CONVERT');

/** Convert `input` bytes into the given output extension (e.g. `.pdf`). */
export type LibreOfficeConvert = (
  input: Buffer,
  outputExtension: string,
) => Promise<Buffer>;

/** Default wall-clock budget for a single soffice conversion. */
const DEFAULT_TIMEOUT_MS = 60_000;
/**
 * Default cap on concurrent soffice conversions. `soffice` spins up a heavy,
 * single-user-profile process per run and is unreliable when many run at once,
 * so conversions past this cap queue instead of oversubscribing the host.
 */
const DEFAULT_MAX_CONCURRENCY = 2;

/**
 * Pure DOCX → PDF converter (input buffer → output buffer).
 *
 * Boundary: this service knows nothing about Prisma, storage, HTTP, or the
 * upload controller. It only turns `.docx` bytes into `.pdf` bytes using
 * LibreOffice headless, applying a timeout + a concurrency limit and, on any
 * failure, throwing the pre-defined Korean copy `document.conversionFailed`.
 * Wiring it into the upload pipeline is a later grain's job.
 *
 * LibreOffice (as opposed to a pure-JS renderer) is chosen so Korean (Hangul)
 * contract layouts survive the round-trip largely intact.
 */
@Injectable()
export class DocumentConversionService {
  private readonly logger = new Logger(DocumentConversionService.name);
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;

  /** In-flight conversions; gates admission to `maxConcurrency`. */
  private active = 0;
  /** FIFO of callers waiting for a free conversion slot. */
  private readonly waiters: Array<() => void> = [];

  constructor(
    config: ConfigService,
    @Inject(LIBREOFFICE_CONVERT) private readonly convert: LibreOfficeConvert,
  ) {
    this.timeoutMs = readPositiveInt(config, 'DOCX_CONVERT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
    this.maxConcurrency = readPositiveInt(config, 'DOCX_CONVERT_CONCURRENCY', DEFAULT_MAX_CONCURRENCY);
  }

  /**
   * Convert a `.docx` buffer to a `.pdf` buffer.
   *
   * Throws `BadRequestException(document.conversionFailed)` for empty input, a
   * conversion error (corrupt/unsupported file), a timeout, or a non-PDF result.
   * The underlying cause is logged (internal) but never surfaced to the user.
   */
  async docxToPdf(docx: Buffer): Promise<Buffer> {
    if (!docx || docx.length === 0) {
      throw new BadRequestException(MESSAGES.document.conversionFailed);
    }

    await this.acquire();
    try {
      const pdf = await this.convertWithTimeout(docx);
      if (!looksLikePdf(pdf)) {
        // soffice exited "successfully" but the bytes aren't a PDF — treat as a
        // conversion failure rather than handing garbage downstream.
        throw new Error('LibreOffice가 유효한 PDF를 반환하지 않았습니다.');
      }
      return pdf;
    } catch (err) {
      this.logger.warn(`DOCX→PDF 변환 실패: ${String(err)}`);
      throw new BadRequestException(MESSAGES.document.conversionFailed);
    } finally {
      this.release();
    }
  }

  // --- internals ----------------------------------------------------------

  /** Race the conversion against the configured timeout. */
  private async convertWithTimeout(docx: Buffer): Promise<Buffer> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`변환이 ${this.timeoutMs}ms 안에 끝나지 않았습니다.`)),
        this.timeoutMs,
      );
    });
    try {
      return await Promise.race([this.convert(docx, '.pdf'), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Take a conversion slot, waiting in FIFO order when at capacity. */
  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /** Release a slot: hand it straight to the next waiter, else free it. */
  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Transfer the slot without touching `active` so the count never dips
      // below the number of runnable conversions (no oversubscription gap).
      next();
    } else {
      this.active -= 1;
    }
  }
}

/** True when `buffer` begins with the `%PDF-` signature. */
function looksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Read a positive integer env value via ConfigService, else the fallback. */
function readPositiveInt(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
