/**
 * Anchor dictionary + rule-based placement unit tests.
 *
 * Pins the design-spec verification goals (A1–A10,
 * `spec-anchor-dictionary-placement.md` §6):
 *   • classification is single-valued, normalized, case-insensitive, substring,
 *     and correctly mapped to the 3 persisted field types,
 *   • weak money keywords are guarded against false positives,
 *   • placement prefers the right of the anchor and falls back below,
 *   • every candidate is a valid in-page NormRect at the default size,
 *   • empty / no-anchor input is safe,
 *   • representative forms land where expected.
 */

import {
  matchAnchor,
  suggestFields,
  placeRect,
  normalize,
  CATEGORY_TO_FIELD_TYPE,
  type AnchorCategory,
  type FieldCandidate,
} from './field-anchors';
import { FIELD_TYPE_META, type NormRect, type SignFieldType } from './field-geometry';
import type { PagePhrases, Phrase } from './pdf-text';

const EPS = 0.001;

function phrase(text: string, rect: NormRect, page = 1): Phrase {
  return { text, page, rect };
}

/** A comfortably-placeable anchor near the page's left/middle. */
function anchorRect(over: Partial<NormRect> = {}): NormRect {
  return { x: 0.1, y: 0.5, width: 0.1, height: 0.03, ...over };
}

// --- A1: single-valued classification ---------------------------------------

describe('matchAnchor — classification (A1)', () => {
  it('classifies a dictionary phrase into exactly one category', () => {
    const m = matchAnchor('서명');
    expect(m).not.toBeNull();
    expect(m!.category).toBe<AnchorCategory>('SIGN');
  });

  it('returns a single winning category when several keywords collide', () => {
    // "금액" (strong AMOUNT, w=2) beats a weak SIGN "인"-style match, and the
    // result is one category, not a list.
    const m = matchAnchor('금액 확인');
    expect(m!.category).toBe('AMOUNT');
  });

  it('is deterministic on equal-weight ties via category priority', () => {
    // Both SIGN "서명"(2) and NAME "성명"(2) present → SIGN wins by priority.
    const m = matchAnchor('서명 성명');
    expect(m!.category).toBe('SIGN');
  });
});

// --- A2: category → field type mapping --------------------------------------

describe('CATEGORY_TO_FIELD_TYPE (A2)', () => {
  it('maps all four categories to the correct persisted field type', () => {
    expect(CATEGORY_TO_FIELD_TYPE).toEqual<Record<AnchorCategory, SignFieldType>>({
      SIGN: 'SIGNATURE',
      DATE: 'DATE',
      NAME: 'TEXT',
      AMOUNT: 'TEXT',
    });
  });
});

// --- A3: normalization / case / substring -----------------------------------

describe('matchAnchor — normalization (A3)', () => {
  it.each(['SIGNATURE', 'signature', '  서명  ', '서명:', '서명 :', '(서명)'])(
    '%s → SIGN',
    (text) => {
      expect(matchAnchor(text)!.category).toBe('SIGN');
    },
  );

  it('folds full-width and separators to a normalized key', () => {
    expect(normalize('ＳＩＧＮ')).toBe('sign'); // full-width → half-width + lowercase
    expect(normalize('  금액 :: ')).toBe('금액');
  });

  it('matches a keyword as a substring inside a longer label', () => {
    expect(matchAnchor('받는 사람 성명')!.category).toBe('NAME');
  });
});

// --- A4: weak money guard ---------------------------------------------------

describe('matchAnchor — amount guard (A4)', () => {
  it('does not match bare 원-containing words with no digit/strong keyword', () => {
    expect(matchAnchor('지원서')).toBeNull();
    expect(matchAnchor('병원')).toBeNull();
  });

  it('matches money when a digit is present', () => {
    expect(matchAnchor('금액 150,000원')!.category).toBe('AMOUNT');
    expect(matchAnchor('150000 원')!.category).toBe('AMOUNT');
  });

  it('matches ₩ amounts', () => {
    expect(matchAnchor('₩ 1,200,000')!.category).toBe('AMOUNT');
  });

  it('does not fire the bare seal mark on words containing 인', () => {
    // exact guard: "(인)" → "인" matches, but "확인"/"신청인" do not (as SIGN).
    expect(matchAnchor('(인)')!.category).toBe('SIGN');
    expect(matchAnchor('확인')).toBeNull();
    expect(matchAnchor('신청인')!.category).toBe('NAME'); // NAME strong, not SIGN
  });
});

// --- A5 / A8: valid in-page rect at default size ----------------------------

describe('placeRect — geometry (A5, A8)', () => {
  const types: SignFieldType[] = ['SIGNATURE', 'DATE', 'TEXT'];

  it.each(types)('%s candidate is a valid in-page NormRect', (type) => {
    const { rect } = placeRect(anchorRect(), type);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1 + EPS);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1 + EPS);
  });

  it.each(types)('%s uses the FIELD_TYPE_META default size when it fits', (type) => {
    const { rect } = placeRect(anchorRect(), type);
    const size = FIELD_TYPE_META[type].defaultSize;
    expect(rect.width).toBeCloseTo(size.width, 6);
    expect(rect.height).toBeCloseTo(size.height, 6);
  });
});

// --- A6: right-first placement ----------------------------------------------

describe('placeRect — right-first (A6)', () => {
  it('places to the right when there is room, vertically centered', () => {
    const anchor = anchorRect({ x: 0.1, width: 0.1, y: 0.5, height: 0.04 });
    const { rect, placement } = placeRect(anchor, 'DATE');
    expect(placement).toBe('right');
    expect(rect.x).toBeGreaterThan(anchor.x + anchor.width);
    const anchorMid = anchor.y + anchor.height / 2;
    const fieldMid = rect.y + rect.height / 2;
    expect(fieldMid).toBeCloseTo(anchorMid, 6);
  });
});

// --- A7: below fallback ------------------------------------------------------

describe('placeRect — below fallback (A7)', () => {
  it('falls below when the right side overflows the page', () => {
    const anchor = anchorRect({ x: 0.95, width: 0.04, y: 0.5, height: 0.03 });
    const { rect, placement } = placeRect(anchor, 'TEXT');
    expect(placement).toBe('below');
    // field top is at/under the anchor bottom (y decreases in y-up space)
    expect(rect.y + rect.height).toBeLessThanOrEqual(anchor.y + EPS);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1 + EPS);
  });

  it('clamps a below-placement that would spill past the page bottom', () => {
    const anchor = anchorRect({ x: 0.95, width: 0.04, y: 0.01, height: 0.02 });
    const { rect } = placeRect(anchor, 'SIGNATURE');
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1 + EPS);
  });
});

// --- A9: empty / no-anchor safety -------------------------------------------

describe('suggestFields — safety (A9)', () => {
  it('returns [] for empty input', () => {
    expect(suggestFields([])).toEqual([]);
  });

  it('returns [] when no phrase is an anchor, without throwing', () => {
    const pages: PagePhrases[] = [
      { page: 1, phrases: [phrase('제목입니다', anchorRect()), phrase('본문 내용', anchorRect())] },
    ];
    expect(suggestFields(pages)).toEqual([]);
  });

  it('preserves page-then-phrase order and carries anchor metadata', () => {
    const pages: PagePhrases[] = [
      {
        page: 1,
        phrases: [phrase('성명', anchorRect(), 1), phrase('서명', anchorRect(), 1)],
      },
      { page: 2, phrases: [phrase('금액 5,000원', anchorRect(), 2)] },
    ];
    const out = suggestFields(pages);
    expect(out.map((c) => c.category)).toEqual<AnchorCategory[]>(['NAME', 'SIGN', 'AMOUNT']);
    expect(out.map((c) => c.type)).toEqual<SignFieldType[]>(['TEXT', 'SIGNATURE', 'TEXT']);
    expect(out[2]!.page).toBe(2);
    expect(out[0]!.anchorText).toBe('성명');
  });

  it('every produced candidate is a valid in-page NormRect', () => {
    const pages: PagePhrases[] = [
      {
        page: 1,
        phrases: [
          phrase('서명 :', anchorRect({ x: 0.1 })),
          phrase('금액 150,000 원', anchorRect({ x: 0.97, width: 0.02 })),
        ],
      },
    ];
    for (const c of suggestFields(pages)) {
      expect(c.rect.x).toBeGreaterThanOrEqual(0);
      expect(c.rect.y).toBeGreaterThanOrEqual(0);
      expect(c.rect.x + c.rect.width).toBeLessThanOrEqual(1 + EPS);
      expect(c.rect.y + c.rect.height).toBeLessThanOrEqual(1 + EPS);
    }
  });
});

// --- A10: representative forms ----------------------------------------------

describe('suggestFields — representative forms (A10)', () => {
  interface Case {
    label: string;
    text: string;
    rect: NormRect;
    category: AnchorCategory;
    type: SignFieldType;
    placement: 'right' | 'below';
  }

  const cases: Case[] = [
    {
      label: '계약서 서명란',
      text: '서명 :',
      rect: { x: 0.1, y: 0.2, width: 0.08, height: 0.03 },
      category: 'SIGN',
      type: 'SIGNATURE',
      placement: 'right',
    },
    {
      label: '계약서 날인 (인)',
      text: '(인)',
      rect: { x: 0.4, y: 0.2, width: 0.04, height: 0.03 },
      category: 'SIGN',
      type: 'SIGNATURE',
      placement: 'right',
    },
    {
      label: '신청서 성명',
      text: '성명',
      rect: { x: 0.12, y: 0.6, width: 0.08, height: 0.03 },
      category: 'NAME',
      type: 'TEXT',
      placement: 'right',
    },
    {
      label: '날짜란',
      text: '작성일',
      rect: { x: 0.12, y: 0.7, width: 0.1, height: 0.03 },
      category: 'DATE',
      type: 'DATE',
      placement: 'right',
    },
    {
      label: '날짜란 (년 월 일)',
      text: '년   월   일',
      rect: { x: 0.5, y: 0.7, width: 0.2, height: 0.03 },
      category: 'DATE',
      type: 'DATE',
      placement: 'right',
    },
    {
      label: '영수증 금액 (우측 → 아래)',
      text: '합계 150,000 원',
      rect: { x: 0.75, y: 0.3, width: 0.22, height: 0.03 },
      category: 'AMOUNT',
      type: 'TEXT',
      placement: 'below',
    },
  ];

  it.each(cases)('$label → $category/$type, placed $placement', (c) => {
    const out = suggestFields([{ page: 1, phrases: [phrase(c.text, c.rect)] }]);
    expect(out).toHaveLength(1);
    const cand: FieldCandidate = out[0]!;
    expect(cand.category).toBe(c.category);
    expect(cand.type).toBe(c.type);

    if (c.placement === 'right') {
      // field sits to the right of the anchor, same page
      expect(cand.rect.x).toBeGreaterThan(c.rect.x + c.rect.width - EPS);
    } else {
      // field sits below the anchor (top edge at/under anchor bottom)
      expect(cand.rect.y + cand.rect.height).toBeLessThanOrEqual(c.rect.y + EPS);
    }
    // always valid in-page
    expect(cand.rect.x + cand.rect.width).toBeLessThanOrEqual(1 + EPS);
    expect(cand.rect.y + cand.rect.height).toBeLessThanOrEqual(1 + EPS);
  });
});
