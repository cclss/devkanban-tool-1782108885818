import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DocumentFormat } from '@repo/db';
import { unzipSync, strFromU8 } from 'fflate';
import { MESSAGES } from '../common/messages';
import { normalizeRect, type NormRect, type PageSize } from '../pdf/field-geometry';

/**
 * A single run of text with its bounding box, in **normalized, bottom-left**
 * page space (0..1 ratios) — the same coordinate convention as a stored
 * `SignField` (see {@link normalizeRect}). Downstream (grain-2/3) feeds these to
 * the AI and returns field placements in the identical space.
 */
export interface ExtractedTextSpan {
  text: string;
  bbox: NormRect;
}

/** One page's extracted content: its point-size media box plus text spans. */
export interface ExtractedPage {
  /** 0-based page index. */
  index: number;
  /** Media-box size in PDF points (unrotated). */
  pageSize: PageSize;
  textSpans: ExtractedTextSpan[];
}

/** The structured, AI-ready representation of a source document. */
export interface ExtractedDocument {
  pages: ExtractedPage[];
}

/** Lazily-loaded pdfjs module handle (ESM-only, imported at runtime). */
type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

// pdfjs-dist ships as pure ESM. Under the API's CommonJS/ts-jest compilation a
// plain `await import()` would be down-levelled to `require()` and fail, so we
// preserve a *native* dynamic import via the Function constructor.
const nativeImport = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<unknown>;

let pdfjsPromise: Promise<PdfjsModule> | null = null;
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = nativeImport('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfjsModule>;
  }
  return pdfjsPromise;
}

// --- DOCX layout constants (points; 1440 twips = 1 inch = 72pt) ------------
const TWIPS_PER_POINT = 20;
/** A4 fallback page size when a DOCX omits its `<w:pgSz>`. */
const DEFAULT_DOCX_PAGE: PageSize = { width: 595.32, height: 841.92 };
/** 1-inch fallback margins when `<w:pgMar>` is missing. */
const DEFAULT_DOCX_MARGIN = 72;
/** Word's default body font size when a run omits `<w:sz>` (11pt = 22 half-pt). */
const DEFAULT_DOCX_FONT_PT = 11;
/** Multiplier from font size to line advance. */
const DOCX_LINE_HEIGHT_RATIO = 1.2;
/** Extra vertical gap after each paragraph, as a fraction of the font size. */
const DOCX_PARAGRAPH_GAP_RATIO = 0.35;
/** Rough average glyph advance as a fraction of the font size (layout estimate). */
const DOCX_CHAR_WIDTH_RATIO = 0.5;

/**
 * Turns raw document bytes into a normalized, per-page text + coordinate
 * structure — the input the AI field-detection step (grain-2/3) consumes.
 *
 * - **PDF**: text runs and their positions are read with `pdfjs-dist`, whose
 *   text transforms are already in bottom-left media-box space.
 * - **DOCX**: OOXML has no absolute geometry (it is a reflowing format), so a
 *   lightweight flow layout is simulated — page size / margins from `<w:sectPr>`,
 *   paragraphs laid out top-to-bottom with naive word wrapping and pagination —
 *   yielding approximate but structurally-faithful boxes.
 *
 * The service is pure (bytes + format → structure); it performs no database
 * writes. Document persistence stays in {@link DocumentsService}.
 */
@Injectable()
export class DocumentExtractionService {
  private readonly logger = new Logger(DocumentExtractionService.name);

  /** Extract per-page text + boxes for the given format. */
  async extract(bytes: Buffer, format: DocumentFormat): Promise<ExtractedDocument> {
    switch (format) {
      case DocumentFormat.PDF:
        return this.extractPdf(bytes);
      case DocumentFormat.DOCX:
        return this.extractDocx(bytes);
      default:
        // Exhaustive over the enum; guards against a future format slipping in.
        throw new BadRequestException(MESSAGES.document.invalidFileType);
    }
  }

  /**
   * Count pages for the given format. PDF uses the cheap structural count;
   * DOCX prefers Word's cached `<Pages>` and otherwise falls back to the flow
   * layout's page count.
   */
  async countPages(bytes: Buffer, format: DocumentFormat): Promise<number> {
    if (format === DocumentFormat.PDF) return this.countPdfPages(bytes);
    return this.countDocxPages(bytes);
  }

  // --- PDF -----------------------------------------------------------------

  private async extractPdf(bytes: Buffer): Promise<ExtractedDocument> {
    const pdfjs = await this.getPdfjs();
    const doc = await pdfjs
      .getDocument({
        data: new Uint8Array(bytes),
        isEvalSupported: false,
        useSystemFonts: false,
      })
      .promise.catch((err: unknown) => {
        this.logger.warn(`PDF 파싱 실패: ${String(err)}`);
        throw new BadRequestException(MESSAGES.document.corruptPdf);
      });

    try {
      const pages: ExtractedPage[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        // `view` is the media box [x0, y0, x1, y1] in points (unrotated).
        const [x0, y0, x1, y1] = page.view;
        const pageSize: PageSize = { width: x1 - x0, height: y1 - y0 };

        const content = await page.getTextContent();
        const textSpans: ExtractedTextSpan[] = [];
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const text = item.str;
          if (!text || !text.trim()) continue;

          // transform = [a, b, c, d, e, f]; (e, f) is the baseline origin in
          // bottom-left media-box space. Height ≈ font size; drop the baseline
          // by an approximate descent so the box bottom sits under the glyphs.
          const baselineX = item.transform[4] - x0;
          const baselineY = item.transform[5] - y0;
          const height = item.height || 0;
          const width = item.width || 0;
          const descent = height * 0.2;

          textSpans.push({
            text,
            bbox: normalizeRect(
              {
                x: baselineX,
                y: baselineY - descent,
                width,
                height,
              },
              pageSize,
            ),
          });
        }

        pages.push({ index: n - 1, pageSize, textSpans });
      }
      return { pages };
    } finally {
      // Release worker/parsing resources deterministically.
      await doc.destroy().catch(() => undefined);
    }
  }

  private async countPdfPages(bytes: Buffer): Promise<number> {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      return pdf.getPageCount();
    } catch (err) {
      this.logger.warn(`PDF 페이지 수 계산 실패: ${String(err)}`);
      throw new BadRequestException(MESSAGES.document.corruptPdf);
    }
  }

  private async getPdfjs(): Promise<PdfjsModule> {
    try {
      return await loadPdfjs();
    } catch (err) {
      this.logger.error(`pdfjs 로드 실패: ${String(err)}`);
      throw new BadRequestException(MESSAGES.document.corruptPdf);
    }
  }

  // --- DOCX ----------------------------------------------------------------

  private extractDocx(bytes: Buffer): ExtractedDocument {
    const documentXml = this.readDocxEntry(bytes, 'word/document.xml');
    if (documentXml == null) {
      throw new BadRequestException(MESSAGES.document.corruptDocx);
    }

    const pageSize = this.parseDocxPageSize(documentXml);
    const margin = this.parseDocxMargin(documentXml);
    const paragraphs = this.parseDocxParagraphs(documentXml);

    const contentLeft = margin.left;
    const contentWidth = Math.max(1, pageSize.width - margin.left - margin.right);
    const contentTop = pageSize.height - margin.top; // bottom-left origin
    const contentBottom = margin.bottom;

    const pages: ExtractedPage[] = [];
    let spans: ExtractedTextSpan[] = [];
    let pageIndex = 0;
    let cursorY = contentTop;

    const pushPage = () => {
      pages.push({ index: pageIndex, pageSize, textSpans: spans });
      pageIndex += 1;
      spans = [];
      cursorY = contentTop;
    };

    for (const para of paragraphs) {
      const fontPt = para.fontPt;
      const lineHeight = fontPt * DOCX_LINE_HEIGHT_RATIO;
      const charWidth = Math.max(0.1, fontPt * DOCX_CHAR_WIDTH_RATIO);
      const maxChars = Math.max(1, Math.floor(contentWidth / charWidth));

      const lines =
        para.text.length === 0
          ? [''] // empty paragraph → one blank line of vertical space
          : para.text.split('\n').flatMap((seg) => wrapLine(seg, maxChars));

      for (const line of lines) {
        // Paginate when the next line would cross the bottom margin.
        if (cursorY - lineHeight < contentBottom && spans.length > 0) {
          pushPage();
        }

        if (line.length > 0) {
          const width = Math.min(contentWidth, line.length * charWidth);
          spans.push({
            text: line,
            bbox: normalizeRect(
              { x: contentLeft, y: cursorY - fontPt, width, height: fontPt },
              pageSize,
            ),
          });
        }
        cursorY -= lineHeight;
      }

      cursorY -= fontPt * DOCX_PARAGRAPH_GAP_RATIO;
    }

    // Always emit at least the final (or an empty) page.
    pushPage();
    return { pages };
  }

  private countDocxPages(bytes: Buffer): number {
    const appXml = this.readDocxEntry(bytes, 'docProps/app.xml');
    if (appXml != null) {
      const match = appXml.match(/<Pages>(\d+)<\/Pages>/);
      if (match) {
        const n = Number.parseInt(match[1], 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    // Fall back to the simulated layout's page count.
    return this.extractDocx(bytes).pages.length;
  }

  /** Read a single UTF-8 text entry from the DOCX (ZIP) package, or null. */
  private readDocxEntry(bytes: Buffer, path: string): string | null {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(new Uint8Array(bytes), { filter: (f) => f.name === path });
    } catch (err) {
      this.logger.warn(`DOCX 압축 해제 실패: ${String(err)}`);
      throw new BadRequestException(MESSAGES.document.corruptDocx);
    }
    const entry = files[path];
    return entry ? strFromU8(entry) : null;
  }

  private parseDocxPageSize(xml: string): PageSize {
    const tag = xml.match(/<w:pgSz\b[^>]*\/?>/);
    if (!tag) return { ...DEFAULT_DOCX_PAGE };
    const w = readTwipsAttr(tag[0], 'w:w');
    const h = readTwipsAttr(tag[0], 'w:h');
    return {
      width: w ?? DEFAULT_DOCX_PAGE.width,
      height: h ?? DEFAULT_DOCX_PAGE.height,
    };
  }

  private parseDocxMargin(xml: string): {
    top: number;
    right: number;
    bottom: number;
    left: number;
  } {
    const tag = xml.match(/<w:pgMar\b[^>]*\/?>/);
    if (!tag) {
      return {
        top: DEFAULT_DOCX_MARGIN,
        right: DEFAULT_DOCX_MARGIN,
        bottom: DEFAULT_DOCX_MARGIN,
        left: DEFAULT_DOCX_MARGIN,
      };
    }
    return {
      top: readTwipsAttr(tag[0], 'w:top') ?? DEFAULT_DOCX_MARGIN,
      right: readTwipsAttr(tag[0], 'w:right') ?? DEFAULT_DOCX_MARGIN,
      bottom: readTwipsAttr(tag[0], 'w:bottom') ?? DEFAULT_DOCX_MARGIN,
      left: readTwipsAttr(tag[0], 'w:left') ?? DEFAULT_DOCX_MARGIN,
    };
  }

  /** Extract paragraphs (text + font size) in document order. */
  private parseDocxParagraphs(xml: string): Array<{ text: string; fontPt: number }> {
    const paragraphs: Array<{ text: string; fontPt: number }> = [];
    const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
    let m: RegExpExecArray | null;
    while ((m = paraRe.exec(xml)) !== null) {
      const inner = m[1];
      const text = extractParagraphText(inner);
      const fontPt = readFontPt(inner);
      paragraphs.push({ text, fontPt });
    }
    return paragraphs;
  }
}

// --- pure DOCX helpers -----------------------------------------------------

/** Read a `w:*` twips attribute off a tag string and convert to points. */
function readTwipsAttr(tag: string, attr: string): number | null {
  const re = new RegExp(`\\b${attr.replace(':', '\\:')}="(-?\\d+)"`);
  const match = tag.match(re);
  if (!match) return null;
  const twips = Number.parseInt(match[1], 10);
  if (!Number.isFinite(twips)) return null;
  return twips / TWIPS_PER_POINT;
}

/** Font size (points) from the first `<w:sz w:val="halfPoints"/>` in a run. */
function readFontPt(paragraphXml: string): number {
  const match = paragraphXml.match(/<w:sz\b[^>]*\bw:val="(\d+)"/);
  if (!match) return DEFAULT_DOCX_FONT_PT;
  const halfPoints = Number.parseInt(match[1], 10);
  if (!Number.isFinite(halfPoints) || halfPoints <= 0) return DEFAULT_DOCX_FONT_PT;
  return halfPoints / 2;
}

/**
 * Concatenate a paragraph's visible text: `<w:t>` runs, `<w:tab/>` → space,
 * `<w:br/>` / `<w:cr/>` → newline (an intra-paragraph line break).
 */
function extractParagraphText(paragraphXml: string): string {
  let out = '';
  const tokenRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(paragraphXml)) !== null) {
    const token = m[0];
    if (token.startsWith('<w:t ') || token.startsWith('<w:t>')) {
      out += decodeXmlEntities(m[1]);
    } else if (token.startsWith('<w:tab')) {
      out += ' ';
    } else {
      out += '\n';
    }
  }
  return out.replace(/[ \t]+/g, ' ').trimEnd();
}

/** Decode the five predefined XML entities. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Naive greedy word-wrap: split a line into chunks of at most `maxChars`,
 * breaking on spaces where possible and hard-splitting over-long words. Returns
 * at least one (possibly empty) segment.
 */
function wrapLine(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [''];
  if (trimmed.length <= maxChars) return [trimmed];

  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > maxChars) {
      // Hard-split a word longer than the content width.
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += maxChars) {
        const chunk = word.slice(i, i + maxChars);
        if (chunk.length === maxChars) lines.push(chunk);
        else current = chunk;
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}
