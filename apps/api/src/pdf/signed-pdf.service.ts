import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, degrees, rgb, type PDFImage } from 'pdf-lib';
import { embedKoreanFont } from './korean-font';
import {
  localToPage,
  resolveFieldPlacement,
  type FieldPlacement,
  type NormRect,
} from './field-geometry';

/** Field type this service can composite (mirrors Prisma's `SignFieldType`). */
export type SignFieldType = 'SIGNATURE' | 'DATE' | 'TEXT';

/**
 * One placed, *filled* field to composite onto the original PDF. Geometry is
 * normalized (0..1, bottom-left origin, relative to the visible page) — the same
 * shape persisted on `SignField`. `value` is the captured value:
 *   • SIGNATURE → an image data URL (`data:image/png|jpeg;base64,…`)
 *   • DATE      → an ISO date string (`YYYY-MM-DD`)
 *   • TEXT      → free text
 */
export interface SignFieldInput extends NormRect {
  type: SignFieldType;
  /** 1-based page index the field sits on. */
  page: number;
  value: string;
}

/** Foreground text color for DATE/TEXT overlays — Design Spec `color/foreground` (#191f28). */
const TEXT_COLOR = rgb(0x19 / 255, 0x1f / 255, 0x28 / 255);

/** Box-relative padding so overlaid content never touches the field edges. */
const PAD_X_RATIO = 0.04;
/** Fraction of the box height the glyph body should occupy before width-fitting. */
const TEXT_HEIGHT_RATIO = 0.62;
/** Floor so an over-long value never shrinks into an unreadable size (points). */
const MIN_FONT_SIZE = 5;

const DATA_URL = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,([\s\S]+)$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Pure service that composites captured `SignField` values onto the original PDF
 * and returns the flattened, signed PDF as a `Buffer`.
 *
 * It has **no** DB / S3 / SES access: input is the original PDF bytes plus the
 * filled field list, output is the synthesized bytes. Coordinate math lives in
 * `field-geometry.ts`; Hangul rendering uses the shared `korean-font` util so
 * the same embed path is reused by the audit-certificate service (grain-3).
 *
 * Queueing, storage, email and status transitions are out of scope (grain-5).
 */
@Injectable()
export class SignedPdfService {
  /**
   * Composite `fields` onto `originalPdf` and return the signed PDF bytes.
   *
   * Each field is converted from normalized (visible-page) geometry into the
   * page's unrotated media-box space — honoring the page `/Rotate` so fields land
   * correctly on rotated pages — then drawn:
   *   • SIGNATURE → the embedded PNG/JPEG, aspect-fit and centered in the box.
   *   • DATE/TEXT → the value in the embedded Korean font, auto-sized to the box.
   *
   * Empty-valued fields are skipped. Throws on an out-of-range page index or an
   * unsupported/embeddable-failed signature image.
   */
  async compose(originalPdf: Buffer | Uint8Array, fields: SignFieldInput[]): Promise<Buffer> {
    const doc = await PDFDocument.load(originalPdf);
    const pages = doc.getPages();

    // Lazily embedded only when a text/date field is actually present.
    let koreanFont: PDFFont | undefined;
    // Cache embedded images by their data URL — the same signature is often
    // placed on multiple pages (initials, per-page sign-off).
    const imageCache = new Map<string, PDFImage>();

    for (const field of fields) {
      if (!field.value || field.value.trim().length === 0) continue;

      const pageIndex = field.page - 1;
      const page = pages[pageIndex];
      if (!page) {
        throw new Error(
          `Sign field references page ${field.page}, but the PDF has ${pages.length} page(s).`,
        );
      }

      const { width, height } = page.getSize();
      const placement = resolveFieldPlacement(
        field,
        { width, height },
        page.getRotation().angle,
      );

      if (field.type === 'SIGNATURE') {
        const image = await this.resolveImage(doc, field.value, imageCache);
        this.drawImageField(page, image, placement);
      } else {
        koreanFont ??= await embedKoreanFont(doc);
        const text = field.type === 'DATE' ? formatDate(field.value) : field.value.trim();
        this.drawTextField(page, text, placement, koreanFont);
      }
    }

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  /** Embed (and cache) a signature image from its data URL. */
  private async resolveImage(
    doc: PDFDocument,
    dataUrl: string,
    cache: Map<string, PDFImage>,
  ): Promise<PDFImage> {
    const cached = cache.get(dataUrl);
    if (cached) return cached;

    const match = DATA_URL.exec(dataUrl.trim());
    if (!match) {
      throw new Error('Signature value is not a base64 image data URL.');
    }
    const mime = match[1]!.toLowerCase();
    const bytes = Uint8Array.from(Buffer.from(match[2]!.replace(/\s/g, ''), 'base64'));

    let image: PDFImage;
    if (mime === 'png') {
      image = await doc.embedPng(bytes);
    } else if (mime === 'jpg' || mime === 'jpeg') {
      image = await doc.embedJpg(bytes);
    } else {
      // pdf-lib can only embed PNG/JPEG raster data.
      throw new Error(`Unsupported signature image type: image/${mime}.`);
    }

    cache.set(dataUrl, image);
    return image;
  }

  /** Aspect-fit the image inside the placed box and draw it centered, upright. */
  private drawImageField(
    page: ReturnType<PDFDocument['getPages']>[number],
    image: PDFImage,
    placement: FieldPlacement,
  ): void {
    const scale = Math.min(placement.width / image.width, placement.height / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;

    // Center within the box (local frame), then map to media-box coordinates.
    const origin = localToPage(placement, (placement.width - drawW) / 2, (placement.height - drawH) / 2);
    page.drawImage(image, {
      x: origin.x,
      y: origin.y,
      width: drawW,
      height: drawH,
      rotate: degrees(placement.rotation),
    });
  }

  /** Auto-size `text` to the placed box and draw it (left-aligned, vertically centered). */
  private drawTextField(
    page: ReturnType<PDFDocument['getPages']>[number],
    text: string,
    placement: FieldPlacement,
    font: PDFFont,
  ): void {
    const padX = placement.width * PAD_X_RATIO;
    const available = Math.max(placement.width - padX * 2, 1);

    // Start from a height-driven size, then shrink to fit the available width.
    let size = placement.height * TEXT_HEIGHT_RATIO;
    const measured = font.widthOfTextAtSize(text, size);
    if (measured > available) size *= available / measured;
    size = Math.max(size, MIN_FONT_SIZE);

    // Vertically center the glyph body within the box (approx baseline offset).
    const baselineV = (placement.height - size) / 2 + size * 0.22;
    const origin = localToPage(placement, padX, baselineV);

    page.drawText(text, {
      x: origin.x,
      y: origin.y,
      size,
      font,
      color: TEXT_COLOR,
      rotate: degrees(placement.rotation),
    });
  }
}

/** Render an ISO `YYYY-MM-DD` date as the project's `YYYY.MM.DD` (voice.md). */
function formatDate(value: string): string {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return value.trim();
  return `${match[1]}.${match[2]}.${match[3]}`;
}
