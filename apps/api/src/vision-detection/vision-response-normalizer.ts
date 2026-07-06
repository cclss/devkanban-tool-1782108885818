import { SignFieldType } from '@repo/db';
import type {
  DetectedFieldType,
  FieldCandidate,
  FieldDetectionResult,
  RawVisionField,
  RawVisionResponse,
} from './vision-detection.types';

/**
 * Normalizes an untrusted {@link RawVisionResponse} from the external Vision
 * service into the shared {@link FieldDetectionResult} — byte-for-byte the same
 * shape the heuristic engine (grain-2) emits, so downstream code never learns
 * which engine produced a result.
 *
 * Defensive by design: the external payload is untrusted, so every field is
 * validated, its geometry clamped into the page, and its type mapped from the
 * external vocabulary to our `SignFieldType`. Anything malformed is dropped, not
 * trusted. A structurally invalid response (no `fields` array) throws
 * {@link VisionResponseError}, which the service turns into a `bad-response`.
 */
export function normalizeVisionResponse(
  raw: RawVisionResponse,
): FieldDetectionResult {
  if (!raw || !Array.isArray(raw.fields)) {
    throw new VisionResponseError('response is missing a fields[] array');
  }

  const fields: FieldCandidate[] = [];
  for (const rawField of raw.fields) {
    const candidate = normalizeField(rawField);
    if (candidate) fields.push(candidate);
  }
  // Reading order (page, then top-to-bottom) for stable output — matches the
  // heuristic engine's ordering.
  fields.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);

  if (fields.length === 0) {
    // The engine ran but surfaced nothing usable. Vision is already the premium
    // last-resort engine, so there is no further fallback to offer.
    return {
      engine: 'vision',
      signal: 'low-confidence',
      fields: [],
      meanConfidence: null,
      fallbackToVision: false,
    };
  }

  const meanConfidence =
    fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length;
  return {
    engine: 'vision',
    signal: meanConfidence < RESULT_LOW_CONFIDENCE ? 'low-confidence' : 'ok',
    fields,
    meanConfidence,
    fallbackToVision: false,
  };
}

/** Raised when the response body does not match the agreed contract. */
export class VisionResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionResponseError';
  }
}

/**
 * Validate + convert one raw field. Returns `null` for anything unusable
 * (unknown type, off-page/degenerate box, sub-threshold confidence) so a single
 * bad entry never poisons the whole result.
 */
function normalizeField(
  rawField: RawVisionField | null | undefined,
): FieldCandidate | null {
  if (!rawField || typeof rawField !== 'object') return null;

  const type = mapFieldType(rawField.type);
  if (!type) return null;

  const page = rawField.page;
  if (!Number.isInteger(page) || page < 1) return null;

  const box = rawField.box;
  if (!box || !allFinite(box.x, box.y, box.width, box.height)) return null;

  const confidence = clamp01(rawField.confidence);
  if (confidence < VISION_ACCEPT_CONFIDENCE) return null;

  // External contract: normalized 0..1 with a TOP-LEFT origin. Our
  // FieldCandidate uses a BOTTOM-LEFT origin (PDF / SignField convention), so
  // flip the Y axis: bottomY = 1 - (topY + height).
  const x = clamp01(box.x);
  const width = Math.min(clamp01(box.width), 1 - x);
  const heightRaw = clamp01(box.height);
  const y = clamp01(1 - (clamp01(box.y) + heightRaw));
  const height = Math.min(heightRaw, 1 - y);
  if (width <= 0 || height <= 0) return null;

  return {
    type,
    page,
    x,
    y,
    width,
    height,
    confidence,
    anchorText: typeof rawField.label === 'string' ? rawField.label.trim() : '',
  };
}

/** Map the external type vocabulary onto our `SignFieldType`, or `null`. */
function mapFieldType(rawType: unknown): DetectedFieldType | null {
  if (typeof rawType !== 'string') return null;
  return TYPE_MAP[rawType.trim().toLowerCase()] ?? null;
}

// --- vision-engine settings (implementation config, not design tokens) -------

/**
 * Minimum per-field confidence to keep a candidate. Below this the model is too
 * unsure for the box to be worth showing.
 */
const VISION_ACCEPT_CONFIDENCE = 0.3;
/**
 * Mean confidence below which the whole result is flagged `low-confidence`.
 * Same threshold as the heuristic engine, so the two tiers judge quality alike.
 */
const RESULT_LOW_CONFIDENCE = 0.55;

/** External field-type vocabulary → our `SignFieldType`. */
const TYPE_MAP: Record<string, DetectedFieldType> = {
  signature: SignFieldType.SIGNATURE,
  sign: SignFieldType.SIGNATURE,
  date: SignFieldType.DATE,
  text: SignFieldType.TEXT,
  textbox: SignFieldType.TEXT,
  input: SignFieldType.TEXT,
};

function allFinite(...values: number[]): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
