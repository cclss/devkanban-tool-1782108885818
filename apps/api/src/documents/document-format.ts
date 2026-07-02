import { DocumentFormat } from '@repo/db';

/**
 * Format detection + validation for uploaded/registered source documents.
 *
 * The system accepts two source formats — PDF and DOCX. Detection mirrors the
 * pre-existing PDF rule (`(mime || extension) && magic bytes`) so a request must
 * both *claim* a supported type and *carry* the matching container signature
 * before it is trusted. When the bytes are not available (e.g. the presigned
 * upload path registers a document by storage key alone) detection falls back to
 * the claimed MIME type / filename extension only.
 *
 * Everything here is dependency-free and pure so it is unit-tested in isolation.
 */

/** Canonical MIME type for PDF. */
export const PDF_MIME = 'application/pdf';
/** Canonical MIME type for DOCX (OOXML WordprocessingML). */
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The result of a successful detection: the format enum + normalized MIME. */
export interface DetectedFormat {
  format: DocumentFormat;
  /** MIME to persist — the claimed type when supported, else the canonical one. */
  mimeType: string;
}

interface DetectInput {
  /** MIME type claimed by the client (multipart or DTO). */
  mimeType?: string | null;
  /** Original filename or storage key — used for the extension check. */
  fileName?: string | null;
  /**
   * Raw bytes, when available. Presence enables the magic-byte check; absence
   * (register-by-key path) falls back to MIME/extension only.
   */
  buffer?: Buffer | null;
}

/** True when the buffer starts with the `%PDF-` header. */
function hasPdfMagic(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * True when the buffer starts with the local-file-header ZIP magic `PK\x03\x04`.
 * DOCX is an OOXML package (a ZIP), so this is the container signature — the
 * MIME/extension guard above narrows a generic ZIP down to DOCX specifically.
 */
function hasZipMagic(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 && // P
    buffer[1] === 0x4b && // K
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

/**
 * Detect and validate the format of an uploaded/registered document.
 * Returns `null` when the input is neither a valid PDF nor a valid DOCX.
 */
export function detectDocumentFormat(input: DetectInput): DetectedFormat | null {
  const mime = (input.mimeType ?? '').toLowerCase().trim();
  const name = (input.fileName ?? '').toLowerCase();
  const buffer = input.buffer ?? null;

  const claimsPdf = mime === PDF_MIME || name.endsWith('.pdf');
  const claimsDocx = mime === DOCX_MIME || name.endsWith('.docx');

  // When bytes are present the magic must corroborate the claim; without bytes
  // we trust the claim alone (the extraction path will reject bad content later).
  const pdfOk = claimsPdf && (buffer ? hasPdfMagic(buffer) : true);
  const docxOk = claimsDocx && (buffer ? hasZipMagic(buffer) : true);

  // A DOCX filename served with a bogus `application/pdf` MIME (or vice versa)
  // is disambiguated by the magic bytes when available.
  if (pdfOk && !docxOk) {
    return { format: DocumentFormat.PDF, mimeType: mime === PDF_MIME ? mime : PDF_MIME };
  }
  if (docxOk && !pdfOk) {
    return { format: DocumentFormat.DOCX, mimeType: mime === DOCX_MIME ? mime : DOCX_MIME };
  }
  if (pdfOk && docxOk) {
    // Both claims pass (ambiguous MIME+extension). Let the magic bytes decide;
    // if bytes are absent, prefer the extension, else PDF.
    if (buffer) {
      if (hasPdfMagic(buffer)) return { format: DocumentFormat.PDF, mimeType: PDF_MIME };
      if (hasZipMagic(buffer)) return { format: DocumentFormat.DOCX, mimeType: DOCX_MIME };
    }
    if (name.endsWith('.docx')) return { format: DocumentFormat.DOCX, mimeType: DOCX_MIME };
    return { format: DocumentFormat.PDF, mimeType: PDF_MIME };
  }
  return null;
}
