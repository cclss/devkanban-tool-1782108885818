import type {
  DetectedFieldType,
  FieldCandidate,
  FieldDetectionResult,
} from '../field-detection/field-detection.types';

/**
 * Data contract for the premium **Vision/LLM** auto-field-placement engine
 * (grain-3). This engine visually analyses image-only / low-confidence PDFs by
 * calling an *external* AI service, then normalizes the answer back into the
 * exact same {@link FieldCandidate} / {@link FieldDetectionResult} shape the
 * heuristic engine (grain-2) produces — so everything downstream stays
 * engine-agnostic.
 *
 * Two contracts are deliberately confirmed and pinned here (the grain's
 * "API 계약과 PII 전송 범위는 착수 전 확정" requirement):
 *
 *  1. **Outgoing (PII scope):** only the pixels + geometry needed for analysis
 *     leave our system — {@link VisionRequestBody}. No account identity, email,
 *     document title, or filename is ever transmitted.
 *  2. **Incoming (response contract):** {@link RawVisionResponse} — an untrusted
 *     payload validated + normalized by `vision-response-normalizer`.
 *
 * `DetectedFieldType`, `FieldCandidate`, and `FieldDetectionResult` are imported
 * from the heuristic engine's module, which owns the shared candidate schema.
 */

// ---------------------------------------------------------------------------
// Adapter input — the caller hands over rendered page images only.
// ---------------------------------------------------------------------------

/**
 * One PDF page rendered to a raster image for visual analysis.
 *
 * `width`/`height` are the page's dimensions in **PDF points**, carried so the
 * normalized (0..1) geometry the service returns lines up with the heuristic
 * engine's `SignField` geometry. `image` holds the encoded raster bytes.
 */
export interface VisionPageImage {
  /** 1-based page number. */
  page: number;
  /** Page width in PDF points. */
  width: number;
  /** Page height in PDF points. */
  height: number;
  /** Encoded raster MIME type, e.g. `image/png` or `image/jpeg`. */
  mimeType: string;
  /** Encoded raster bytes for this page. */
  image: Buffer;
}

/**
 * The adapter's only input: the document as page images. Rendering a PDF to
 * images is a separate concern (a later grain binds a concrete renderer), so
 * this engine — like the heuristic detector with its text layer — is fixture
 * testable and free of PDF-parsing dependencies.
 */
export interface VisionAnalysisInput {
  pages: VisionPageImage[];
}

// ---------------------------------------------------------------------------
// Outgoing wire payload — the PII transmission boundary.
// ---------------------------------------------------------------------------

/** One page as it is serialized onto the wire (image as base64). */
export interface VisionRequestPage {
  page: number;
  width: number;
  height: number;
  mimeType: string;
  /** base64-encoded raster bytes. */
  image: string;
}

/**
 * The exact JSON body POSTed to the external service. This type IS the PII
 * boundary: it carries page pixels + dimensions and nothing else. Adding any
 * account/document metadata field here would widen what we transmit, so it is
 * kept intentionally minimal and built explicitly (see `vision-payload.ts`).
 */
export interface VisionRequestBody {
  pages: VisionRequestPage[];
}

// ---------------------------------------------------------------------------
// Incoming response contract — untrusted, validated by the normalizer.
// ---------------------------------------------------------------------------

/**
 * A field box as returned by the external service: normalized (0..1) with a
 * **top-left origin** (the common image/vision convention). The normalizer
 * flips the Y axis to our bottom-left `FieldCandidate` origin.
 */
export interface RawVisionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One field proposal from the external service (untrusted shape). */
export interface RawVisionField {
  /** External type vocabulary, e.g. `"signature" | "date" | "text"`. */
  type: string;
  /** 1-based page number. */
  page: number;
  /** Normalized, top-left-origin box. */
  box: RawVisionBox;
  /** Model confidence, expected 0..1. */
  confidence: number;
  /** Optional label the model read near the field (kept as `anchorText`). */
  label?: string;
}

/** The external service's response body (untrusted shape). */
export interface RawVisionResponse {
  fields: RawVisionField[];
}

// ---------------------------------------------------------------------------
// Result / error — the adapter returns a safe union, it does not throw.
// ---------------------------------------------------------------------------

/**
 * Why a Vision analysis failed. These are **structured signals**, not
 * user-facing copy — the UI grains compose the actual prompt shown to a user.
 *
 *  - `unavailable`  — the engine is not configured (no endpoint/API key). No
 *                     outbound call was made.
 *  - `timeout`      — the request exceeded the configured deadline.
 *  - `api-error`    — transport failure or a non-2xx HTTP response.
 *  - `bad-response` — a 2xx response whose body did not match the contract.
 */
export type VisionErrorReason =
  | 'unavailable'
  | 'timeout'
  | 'api-error'
  | 'bad-response';

/** A safe, structured description of a failed Vision analysis. */
export interface VisionEngineError {
  reason: VisionErrorReason;
  /**
   * Internal diagnostic detail for logs/telemetry. Never user-facing copy and
   * never carries document content or PII.
   */
  detail?: string;
  /** HTTP status, when `reason === 'api-error'` came from a response. */
  status?: number;
}

/**
 * The adapter's public result. Success carries a normalized
 * {@link FieldDetectionResult} (`engine: 'vision'`); failure carries a
 * {@link VisionEngineError}. Modeled as a union so callers handle failure
 * explicitly instead of catching thrown errors.
 */
export type VisionEngineResult =
  | { ok: true; result: FieldDetectionResult }
  | { ok: false; error: VisionEngineError };

export type { DetectedFieldType, FieldCandidate, FieldDetectionResult };
