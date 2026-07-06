import {
  normalizeVisionResponse,
  VisionResponseError,
} from './vision-response-normalizer';
import { SignFieldType } from '@repo/db';
import type {
  RawVisionField,
  RawVisionResponse,
} from './vision-detection.types';

function field(overrides: Partial<RawVisionField> = {}): RawVisionField {
  return {
    type: 'signature',
    page: 1,
    box: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
    confidence: 0.9,
    ...overrides,
  };
}

describe('normalizeVisionResponse', () => {
  it('produces the shared FieldDetectionResult shape with engine "vision"', () => {
    const raw: RawVisionResponse = { fields: [field({ label: '서명' })] };
    const result = normalizeVisionResponse(raw);

    expect(result.engine).toBe('vision');
    expect(result.signal).toBe('ok');
    expect(result.fallbackToVision).toBe(false); // vision is the last-resort tier
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toMatchObject({
      type: SignFieldType.SIGNATURE,
      page: 1,
      confidence: 0.9,
      anchorText: '서명',
    });
    expect(result.meanConfidence).toBeCloseTo(0.9);
  });

  it('flips the Y axis from top-left (external) to bottom-left (our) origin', () => {
    const raw: RawVisionResponse = {
      fields: [field({ box: { x: 0.2, y: 0.1, width: 0.3, height: 0.25 } })],
    };
    const [candidate] = normalizeVisionResponse(raw).fields;

    expect(candidate.x).toBeCloseTo(0.2);
    expect(candidate.width).toBeCloseTo(0.3);
    expect(candidate.height).toBeCloseTo(0.25);
    // bottomY = 1 - (topY + height) = 1 - (0.1 + 0.25) = 0.65
    expect(candidate.y).toBeCloseTo(0.65);
  });

  it('maps the external type vocabulary onto SignFieldType', () => {
    const raw: RawVisionResponse = {
      fields: [
        field({ type: 'SIGN', page: 1, box: { x: 0, y: 0, width: 0.2, height: 0.1 } }),
        field({ type: 'Date', page: 1, box: { x: 0, y: 0.2, width: 0.2, height: 0.1 } }),
        field({ type: 'textbox', page: 1, box: { x: 0, y: 0.4, width: 0.2, height: 0.1 } }),
      ],
    };
    const types = normalizeVisionResponse(raw).fields.map((f) => f.type);

    expect(types).toContain(SignFieldType.SIGNATURE);
    expect(types).toContain(SignFieldType.DATE);
    expect(types).toContain(SignFieldType.TEXT);
  });

  it('drops unusable candidates (unknown type, low confidence, off-page/degenerate box)', () => {
    const raw: RawVisionResponse = {
      fields: [
        field({ type: 'checkbox' }), // unknown type
        field({ confidence: 0.1 }), // below accept threshold
        field({ box: { x: 0.5, y: 0.5, width: 0, height: 0.2 } }), // zero width
        field({ box: { x: 0.1, y: 0.1, width: NaN, height: 0.2 } }), // non-finite
        field({ page: 0 }), // invalid page
        field({ label: 'keep-me' }), // the one valid field
      ],
    };
    const result = normalizeVisionResponse(raw);

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].anchorText).toBe('keep-me');
  });

  it('clamps an over-large box inside the page', () => {
    const raw: RawVisionResponse = {
      fields: [field({ box: { x: 0.9, y: 0, width: 0.5, height: 0.5 } })],
    };
    const [candidate] = normalizeVisionResponse(raw).fields;

    expect(candidate.x + candidate.width).toBeLessThanOrEqual(1);
    expect(candidate.y + candidate.height).toBeLessThanOrEqual(1);
  });

  it('returns an empty low-confidence result when nothing survives', () => {
    const result = normalizeVisionResponse({ fields: [field({ type: 'nope' })] });

    expect(result.signal).toBe('low-confidence');
    expect(result.fields).toEqual([]);
    expect(result.meanConfidence).toBeNull();
    expect(result.fallbackToVision).toBe(false);
  });

  it('flags low-confidence when the mean confidence is weak', () => {
    const raw: RawVisionResponse = {
      fields: [
        field({ confidence: 0.4, box: { x: 0, y: 0, width: 0.2, height: 0.1 } }),
        field({ confidence: 0.4, box: { x: 0, y: 0.3, width: 0.2, height: 0.1 } }),
      ],
    };
    const result = normalizeVisionResponse(raw);

    expect(result.fields).toHaveLength(2);
    expect(result.signal).toBe('low-confidence');
  });

  it('sorts candidates in reading order (page, then top-to-bottom)', () => {
    // External boxes are top-left origin: a SMALLER y sits visually higher.
    const raw: RawVisionResponse = {
      fields: [
        field({ page: 2, box: { x: 0, y: 0.1, width: 0.2, height: 0.1 }, label: 'p2' }),
        field({ page: 1, box: { x: 0, y: 0.8, width: 0.2, height: 0.1 }, label: 'p1-bottom' }),
        field({ page: 1, box: { x: 0, y: 0.1, width: 0.2, height: 0.1 }, label: 'p1-top' }),
      ],
    };
    const labels = normalizeVisionResponse(raw).fields.map((f) => f.anchorText);

    expect(labels).toEqual(['p1-top', 'p1-bottom', 'p2']);
  });

  it('throws VisionResponseError for a structurally invalid response', () => {
    expect(() => normalizeVisionResponse({} as RawVisionResponse)).toThrow(
      VisionResponseError,
    );
    expect(() =>
      normalizeVisionResponse({ fields: 'nope' } as unknown as RawVisionResponse),
    ).toThrow(VisionResponseError);
  });
});
