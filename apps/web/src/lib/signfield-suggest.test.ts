/**
 * Sign-field suggestion engine unit tests.
 *
 * These pin classification, placement, confidence, and the safety invariants
 * (in-page clamping, no-overlap, never-throws) across representative Korean and
 * English contract layouts:
 *   • right-aligned signature box,
 *   • bottom signature + date line,
 *   • blank underline text field,
 *   • multi-page documents,
 *   • text-free / empty input (scanned PDF) → empty result.
 */

import {
  suggestSignFields,
  type TextToken,
  type SignFieldSuggestion,
} from './signfield-suggest';
import { type NormRect } from './field-geometry';

/** Build a token; rect is bottom-left origin, normalized 0..1. */
function tok(text: string, page: number, rect: NormRect): TextToken {
  return { text, page, rect };
}

/** First suggestion, asserted present (keeps tests type-safe under strict). */
function only(out: SignFieldSuggestion[]): SignFieldSuggestion {
  expect(out.length).toBeGreaterThan(0);
  return out[0]!;
}

function rectOf(s: SignFieldSuggestion): NormRect {
  return { x: s.x, y: s.y, width: s.width, height: s.height };
}

function within01(s: SignFieldSuggestion): boolean {
  return (
    s.x >= 0 &&
    s.y >= 0 &&
    s.width > 0 &&
    s.height > 0 &&
    s.x + s.width <= 1 + 1e-9 &&
    s.y + s.height <= 1 + 1e-9
  );
}

function overlaps(a: NormRect, b: NormRect): boolean {
  const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return ix > 1e-6 && iy > 1e-6;
}

describe('suggestSignFields — empty / text-free input', () => {
  it('returns [] for an empty token array (no throw)', () => {
    expect(suggestSignFields([])).toEqual([]);
  });

  it('returns [] for a scanned PDF with no recoverable text', () => {
    // pdfjs yields nothing for an image-only scan.
    expect(() => suggestSignFields([])).not.toThrow();
    expect(suggestSignFields([])).toHaveLength(0);
  });

  it('returns [] when no token matches any anchor', () => {
    const tokens = [
      tok('본', 1, { x: 0.1, y: 0.8, width: 0.05, height: 0.02 }),
      tok('계약서', 1, { x: 0.2, y: 0.8, width: 0.12, height: 0.03 }),
      tok('제1조', 1, { x: 0.1, y: 0.7, width: 0.08, height: 0.02 }),
    ];
    expect(suggestSignFields(tokens)).toEqual([]);
  });

  it('does not throw on malformed tokens and skips them', () => {
    const tokens = [
      // empty text, NaN geometry, bad page — all dropped.
      tok('', 1, { x: 0.1, y: 0.1, width: 0.1, height: 0.05 }),
      tok('서명', 0, { x: 0.1, y: 0.1, width: 0.1, height: 0.05 }),
      tok('서명', 1, { x: NaN, y: 0.1, width: 0.1, height: 0.05 }),
    ];
    expect(() => suggestSignFields(tokens)).not.toThrow();
    expect(suggestSignFields(tokens)).toEqual([]);
  });
});

describe('classification by anchor', () => {
  it('classifies 서명 → SIGNATURE', () => {
    const f = only(
      suggestSignFields([
        tok('서명', 1, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
      ]),
    );
    expect(f.type).toBe('SIGNATURE');
    expect(f.source).toBe('ai');
    expect(f.anchorLabel).toBe('서명');
  });

  it('classifies the (인) seal marker → SIGNATURE', () => {
    const f = only(
      suggestSignFields([
        tok('(인)', 1, { x: 0.6, y: 0.2, width: 0.06, height: 0.03 }),
      ]),
    );
    expect(f.type).toBe('SIGNATURE');
  });

  it('classifies 날짜 / 일자 → DATE', () => {
    const a = only(
      suggestSignFields([
        tok('날짜', 1, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
      ]),
    );
    const b = only(
      suggestSignFields([
        tok('일자', 1, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
      ]),
    );
    expect(a.type).toBe('DATE');
    expect(b.type).toBe('DATE');
  });

  it('classifies 성명 / 이름 → TEXT', () => {
    const a = only(
      suggestSignFields([
        tok('성명', 1, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
      ]),
    );
    const b = only(
      suggestSignFields([
        tok('이름', 1, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
      ]),
    );
    expect(a.type).toBe('TEXT');
    expect(b.type).toBe('TEXT');
  });

  it('classifies a blank underline run → TEXT', () => {
    const f = only(
      suggestSignFields([
        tok('__________', 1, { x: 0.2, y: 0.3, width: 0.3, height: 0.02 }),
      ]),
    );
    expect(f.type).toBe('TEXT');
  });

  it('classifies English Signature / Date / Name', () => {
    const out = suggestSignFields([
      tok('Signature', 1, { x: 0.1, y: 0.3, width: 0.16, height: 0.03 }),
      tok('Date', 1, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
      tok('Name', 1, { x: 0.1, y: 0.1, width: 0.08, height: 0.03 }),
    ]);
    const types = out.map((o) => o.type).sort();
    expect(types).toEqual(['DATE', 'SIGNATURE', 'TEXT']);
  });

  it('does not fire Latin anchors inside larger words', () => {
    // "design" contains "sign", "username" contains "name" — must not match.
    const out = suggestSignFields([
      tok('design', 1, { x: 0.1, y: 0.3, width: 0.12, height: 0.03 }),
      tok('username', 1, { x: 0.1, y: 0.2, width: 0.14, height: 0.03 }),
    ]);
    expect(out).toEqual([]);
  });
});

describe('expanded signature / date lexicon (real contract markers)', () => {
  it('classifies 도장 / 직인 seal markers → SIGNATURE', () => {
    for (const label of ['도장', '직인', '도장 날인']) {
      const f = only(
        suggestSignFields([tok(label, 1, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 })]),
      );
      expect(f.type).toBe('SIGNATURE');
    }
  });

  it('classifies full-width / bracketed 인 seal markers → SIGNATURE', () => {
    for (const label of ['（인）', '[인]', '( 인 )']) {
      const f = only(
        suggestSignFields([tok(label, 1, { x: 0.6, y: 0.2, width: 0.06, height: 0.03 })]),
      );
      expect(f.type).toBe('SIGNATURE');
    }
  });

  it('classifies 계약일 / 발행일 / 체결일 date labels → DATE', () => {
    for (const label of ['계약일', '발행일', '체결일', '계약일자']) {
      const f = only(
        suggestSignFields([tok(label, 1, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 })]),
      );
      expect(f.type).toBe('DATE');
    }
  });

  it('classifies a single-token "년 월 일" date line → DATE, placed on the line', () => {
    const line: NormRect = { x: 0.3, y: 0.1, width: 0.3, height: 0.03 };
    for (const label of ['년    월    일', '20__년 __월 __일', '2024년 1월 1일']) {
      const f = only(suggestSignFields([tok(label, 1, line)]));
      expect(f.type).toBe('DATE');
      // sits ON the line (shares its left + baseline), not off to the right.
      expect(f.x).toBeCloseTo(line.x, 6);
      expect(f.y).toBeCloseTo(line.y, 6);
    }
  });

  it('reassembles a "년 / 월 / 일" date line split across separate tokens → one DATE', () => {
    // pdfjs commonly splits a spaced fill-in line into individual runs.
    const out = suggestSignFields([
      tok('2024', 1, { x: 0.30, y: 0.1, width: 0.05, height: 0.03 }),
      tok('년', 1, { x: 0.36, y: 0.1, width: 0.03, height: 0.03 }),
      tok('월', 1, { x: 0.46, y: 0.1, width: 0.03, height: 0.03 }),
      tok('일', 1, { x: 0.56, y: 0.1, width: 0.03, height: 0.03 }),
    ]);
    expect(out).toHaveLength(1);
    const f = out[0]!;
    expect(f.type).toBe('DATE');
    // spans from the 년 marker to past the 일 marker.
    expect(f.x).toBeCloseTo(0.36, 6);
    expect(f.x + f.width).toBeGreaterThanOrEqual(0.59 - 1e-9);
    expect(within01(f)).toBe(true);
  });

  it('does not invent a date from a lone 년 (a year mention in prose)', () => {
    const out = suggestSignFields([
      tok('2024년', 1, { x: 0.1, y: 0.8, width: 0.08, height: 0.03 }),
      tok('상반기', 1, { x: 0.2, y: 0.8, width: 0.08, height: 0.03 }),
    ]);
    expect(out).toEqual([]);
  });

  it('does not treat 일요일 / 금일 as date markers', () => {
    const out = suggestSignFields([
      tok('일요일', 1, { x: 0.1, y: 0.5, width: 0.08, height: 0.03 }),
      tok('금일', 1, { x: 0.3, y: 0.5, width: 0.08, height: 0.03 }),
    ]);
    expect(out).toEqual([]);
  });

  it('places both a signature seal and a "년 월 일" date on a closing line', () => {
    // A realistic Korean closing block with NO 날짜/서명 labels at all.
    const out = suggestSignFields([
      tok('년   월   일', 1, { x: 0.4, y: 0.2, width: 0.25, height: 0.03 }),
      tok('홍길동', 1, { x: 0.4, y: 0.1, width: 0.1, height: 0.03 }),
      tok('(인)', 1, { x: 0.55, y: 0.1, width: 0.05, height: 0.03 }),
    ]);
    const types = out.map((o) => o.type).sort();
    expect(types).toContain('DATE');
    expect(types).toContain('SIGNATURE');
  });
});

describe('placement', () => {
  it('places a right-aligned signature field to the right of its anchor', () => {
    const anchor: NormRect = { x: 0.6, y: 0.15, width: 0.08, height: 0.03 };
    const f = only(suggestSignFields([tok('서명', 1, anchor)]));
    // field starts past the anchor's right edge...
    expect(f.x).toBeGreaterThanOrEqual(anchor.x + anchor.width);
    // ...and is vertically centered on the anchor.
    const anchorCenter = anchor.y + anchor.height / 2;
    const fieldCenter = f.y + f.height / 2;
    expect(fieldCenter).toBeCloseTo(anchorCenter, 6);
    // SIGNATURE default footprint.
    expect(f.width).toBeCloseTo(0.26, 6);
    expect(f.height).toBeCloseTo(0.08, 6);
  });

  it('places a text field ON the blank underline (spanning it)', () => {
    const blank: NormRect = { x: 0.2, y: 0.3, width: 0.3, height: 0.02 };
    const f = only(suggestSignFields([tok('____________', 1, blank)]));
    expect(f.x).toBeCloseTo(blank.x, 6);
    // field spans at least the underline width.
    expect(f.width).toBeGreaterThanOrEqual(blank.width - 1e-9);
    // sits on the line (shares its bottom baseline).
    expect(f.y).toBeCloseTo(blank.y, 6);
  });

  it('clamps a field that would overflow the right edge back into the page', () => {
    // Anchor hard against the right edge → field would spill past x=1.
    const f = only(
      suggestSignFields([
        tok('서명', 1, { x: 0.92, y: 0.5, width: 0.06, height: 0.03 }),
      ]),
    );
    expect(within01(f)).toBe(true);
    expect(f.x + f.width).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('keeps every field within the page on all anchors', () => {
    const out = suggestSignFields([
      tok('서명', 1, { x: 0.0, y: 0.0, width: 0.06, height: 0.02 }),
      tok('날짜', 1, { x: 0.95, y: 0.97, width: 0.04, height: 0.02 }),
      tok('이름', 1, { x: 0.5, y: 0.5, width: 0.06, height: 0.02 }),
    ]);
    expect(out.length).toBeGreaterThan(0);
    for (const f of out) expect(within01(f)).toBe(true);
  });
});

describe('representative layout — bottom signature + date line', () => {
  it('proposes one SIGNATURE and one DATE on the same page', () => {
    // A common closing line: "서명: ____   날짜: ____" near the page bottom.
    const out = suggestSignFields([
      tok('서명', 1, { x: 0.1, y: 0.1, width: 0.08, height: 0.03 }),
      tok('날짜', 1, { x: 0.55, y: 0.1, width: 0.08, height: 0.03 }),
    ]);
    expect(out).toHaveLength(2);
    const types = out.map((o) => o.type);
    expect(types).toContain('SIGNATURE');
    expect(types).toContain('DATE');
    for (const f of out) expect(f.page).toBe(1);
  });
});

describe('representative layout — right-side signature block', () => {
  it('classifies and places a right-column signature + name + date', () => {
    const out = suggestSignFields([
      tok('성명', 1, { x: 0.55, y: 0.4, width: 0.08, height: 0.03 }),
      tok('서명', 1, { x: 0.55, y: 0.3, width: 0.08, height: 0.03 }),
      tok('날짜', 1, { x: 0.55, y: 0.2, width: 0.08, height: 0.03 }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.type).sort()).toEqual(['DATE', 'SIGNATURE', 'TEXT']);
    // reading order (top → bottom) preserved: 성명(top), 서명, 날짜(bottom).
    expect(out.map((o) => o.type)).toEqual(['TEXT', 'SIGNATURE', 'DATE']);
  });
});

describe('multi-page documents', () => {
  it('keeps suggestions on their source pages', () => {
    const out = suggestSignFields([
      tok('서명', 1, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
      tok('서명', 2, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
      tok('날짜', 3, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.page)).toEqual([1, 2, 3]);
  });
});

describe('confidence', () => {
  it('assigns confidence in (0, 1] with stronger anchors scoring higher', () => {
    const sig = only(
      suggestSignFields([
        tok('서명', 1, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
      ]),
    );
    const blank = only(
      suggestSignFields([
        tok('__________', 1, { x: 0.1, y: 0.2, width: 0.3, height: 0.02 }),
      ]),
    );

    for (const c of [sig.confidence, blank.confidence]) {
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    // explicit "서명" is more certain than an ambiguous blank line.
    expect(sig.confidence).toBeGreaterThan(blank.confidence);
    // strong anchors clear the "trust it" bar.
    expect(sig.confidence).toBeGreaterThan(0.5);
  });

  it('penalizes a field that had to be nudged off an overlap', () => {
    // Two signature anchors close enough that placement collides.
    const out = suggestSignFields([
      tok('서명', 1, { x: 0.1, y: 0.5, width: 0.06, height: 0.03 }),
      tok('(인)', 1, { x: 0.18, y: 0.5, width: 0.06, height: 0.03 }),
    ]);
    // both survive, but the nudged one carries a lower-than-base confidence.
    const confidences = out.map((o) => o.confidence);
    expect(Math.min(...confidences)).toBeLessThan(0.92);
  });
});

describe('overlap avoidance', () => {
  it('produces no overlapping fields on the same page', () => {
    // A dense block of anchors that would naively collide.
    const tokens: TextToken[] = [
      tok('서명', 1, { x: 0.1, y: 0.5, width: 0.06, height: 0.03 }),
      tok('날인', 1, { x: 0.17, y: 0.5, width: 0.06, height: 0.03 }),
      tok('(인)', 1, { x: 0.24, y: 0.5, width: 0.06, height: 0.03 }),
      tok('이름', 1, { x: 0.1, y: 0.45, width: 0.06, height: 0.03 }),
    ];
    const out = suggestSignFields(tokens);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        if (a.page !== b.page) continue;
        expect(overlaps(rectOf(a), rectOf(b))).toBe(false);
      }
    }
  });
});

describe('output contract', () => {
  it('every suggestion is source:ai with a stable id and an anchor label', () => {
    const out = suggestSignFields([
      tok('서명', 1, { x: 0.1, y: 0.3, width: 0.08, height: 0.03 }),
      tok('날짜', 1, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
    ]);
    expect(out.map((o) => o.id)).toEqual(['ai-1', 'ai-2']);
    for (const f of out) {
      expect(f.source).toBe('ai');
      expect(f.anchorLabel.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic across repeated calls', () => {
    const tokens: TextToken[] = [
      tok('서명', 1, { x: 0.1, y: 0.3, width: 0.08, height: 0.03 }),
      tok('날짜', 2, { x: 0.1, y: 0.2, width: 0.08, height: 0.03 }),
      tok('__________', 1, { x: 0.1, y: 0.5, width: 0.3, height: 0.02 }),
    ];
    expect(suggestSignFields(tokens)).toEqual(suggestSignFields(tokens));
  });

  it('honors maxPerPage by keeping the highest-confidence fields', () => {
    const out = suggestSignFields(
      [
        tok('서명', 1, { x: 0.1, y: 0.7, width: 0.08, height: 0.03 }),
        tok('날짜', 1, { x: 0.1, y: 0.5, width: 0.08, height: 0.03 }),
        tok('__________', 1, { x: 0.1, y: 0.3, width: 0.3, height: 0.02 }),
      ],
      { maxPerPage: 1 },
    );
    expect(out).toHaveLength(1);
    // SIGNATURE (0.92) outranks DATE (0.88) and the blank (0.62).
    expect(only(out).type).toBe('SIGNATURE');
  });
});
