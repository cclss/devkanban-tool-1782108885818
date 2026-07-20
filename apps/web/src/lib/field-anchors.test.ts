/**
 * Pure tests for rule-based anchor detection + field candidate placement.
 *
 * Two layers are pinned:
 *   • matching — normalization (lowercase, strip whitespace/brackets), the
 *     substring-vs-whole-phrase rule that keeps "인"/"원" from over-firing, and
 *     the multi-kind tie-break,
 *   • placement — right-by-default, drop-below-when-tight, clamped in-page, with
 *     the output box in the same 0..1 bottom-left shape the field model uses.
 *
 * Representative forms are synthetic Korean-contract layouts (a signing block, a
 * 금액 line, an English-labeled form) — no PDF, no DOM — so the expected kind and
 * rough position of each candidate are asserted directly.
 */

import {
  ANCHOR_FIELD_TYPE,
  classifyAnchor,
  normalizeAnchorText,
  phrasesToFieldCandidates,
  type FieldCandidate,
} from './field-anchors';
import type { NormRect } from './field-geometry';
import type { PagePhrases, Phrase } from './pdf-text';

function phrase(text: string, x: number, y: number, width: number, height = 0.02): Phrase {
  return { text, rect: { x, y, width, height } };
}

function centerY(rect: NormRect): number {
  return rect.y + rect.height / 2;
}

function pick(cands: FieldCandidate[], kind: FieldCandidate['kind']): FieldCandidate {
  const found = cands.find((c) => c.kind === kind);
  if (!found) throw new Error(`no ${kind} candidate`);
  return found;
}

describe('normalizeAnchorText', () => {
  it('lowercases and strips whitespace and brackets', () => {
    expect(normalizeAnchorText('(인)')).toBe('인');
    expect(normalizeAnchorText('성 명')).toBe('성명');
    expect(normalizeAnchorText('SIGNATURE')).toBe('signature');
    expect(normalizeAnchorText('[금액]')).toBe('금액');
  });
});

describe('classifyAnchor', () => {
  it('classifies each of the four kinds from a representative label', () => {
    expect(classifyAnchor('서명')).toBe('signature');
    expect(classifyAnchor('사인')).toBe('signature');
    expect(classifyAnchor('signature')).toBe('signature');
    expect(classifyAnchor('날짜')).toBe('date');
    expect(classifyAnchor('작성일')).toBe('date');
    expect(classifyAnchor('date')).toBe('date');
    expect(classifyAnchor('이름')).toBe('name');
    expect(classifyAnchor('성명')).toBe('name');
    expect(classifyAnchor('name')).toBe('name');
    expect(classifyAnchor('금액')).toBe('amount');
    expect(classifyAnchor('amount')).toBe('amount');
  });

  it('matches multi-syllable keywords as substrings', () => {
    expect(classifyAnchor('서명란')).toBe('signature');
    expect(classifyAnchor('작성일자')).toBe('date');
    expect(classifyAnchor('지원 금액')).toBe('amount');
  });

  it('matches "(인)" as a seal anchor but not words that merely contain 인', () => {
    expect(classifyAnchor('(인)')).toBe('signature');
    expect(classifyAnchor('확인')).toBeNull();
    expect(classifyAnchor('본인 확인')).toBeNull();
  });

  it('matches a bare "원" cell but not words that merely contain 원', () => {
    expect(classifyAnchor('원')).toBe('amount');
    expect(classifyAnchor('원본')).toBeNull();
    expect(classifyAnchor('지원')).toBeNull();
  });

  it('returns null for non-anchor phrases', () => {
    expect(classifyAnchor('본 계약을 체결한다')).toBeNull();
    expect(classifyAnchor('')).toBeNull();
  });

  it('breaks multi-kind ties by priority (signature over name)', () => {
    expect(classifyAnchor('성명 및 서명')).toBe('signature');
  });
});

describe('ANCHOR_FIELD_TYPE mapping', () => {
  it('maps kinds to field types (amount → text input)', () => {
    expect(ANCHOR_FIELD_TYPE.signature).toBe('SIGNATURE');
    expect(ANCHOR_FIELD_TYPE.date).toBe('DATE');
    expect(ANCHOR_FIELD_TYPE.name).toBe('TEXT');
    expect(ANCHOR_FIELD_TYPE.amount).toBe('TEXT');
  });
});

describe('phrasesToFieldCandidates — placement', () => {
  it('places the field to the right of the anchor, vertically centered', () => {
    const pages: PagePhrases[] = [{ page: 1, phrases: [phrase('서명', 0.1, 0.1, 0.05)] }];
    const [cand] = phrasesToFieldCandidates(pages);
    expect(cand!.kind).toBe('signature');
    expect(cand!.type).toBe('SIGNATURE');
    // right of the anchor: x ≈ anchor.x + anchor.width + gap
    expect(cand!.rect.x).toBeCloseTo(0.1 + 0.05 + 0.01, 5);
    // vertical center aligns with the anchor's center (0.1 + 0.02/2 = 0.11)
    expect(centerY(cand!.rect)).toBeCloseTo(0.11, 5);
    // default SIGNATURE footprint
    expect(cand!.rect.width).toBeCloseTo(0.26, 5);
    expect(cand!.rect.height).toBeCloseTo(0.08, 5);
  });

  it('drops below the anchor when the right margin is too tight, then clamps', () => {
    const pages: PagePhrases[] = [{ page: 1, phrases: [phrase('금액', 0.85, 0.5, 0.05)] }];
    const [cand] = phrasesToFieldCandidates(pages);
    expect(cand!.kind).toBe('amount');
    // not placed to the right (would overflow) — sits below the anchor bottom
    expect(cand!.rect.y).toBeLessThan(0.5);
    // clamped fully inside the page
    expect(cand!.rect.x).toBeLessThanOrEqual(1 - cand!.rect.width + 1e-9);
    expect(cand!.rect.x).toBeGreaterThanOrEqual(0);
    expect(cand!.rect.y).toBeGreaterThanOrEqual(0);
  });

  it('keeps every candidate a valid in-page 0..1 box', () => {
    const pages: PagePhrases[] = [
      { page: 1, phrases: [phrase('서명', 0.9, 0.95, 0.08), phrase('금액', 0.02, 0.02, 0.05)] },
    ];
    for (const cand of phrasesToFieldCandidates(pages)) {
      const { x, y, width, height } = cand.rect;
      for (const v of [x, y, width, height]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(x + width).toBeLessThanOrEqual(1 + 1e-9);
      expect(y + height).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('skips non-anchor phrases and preserves reading order + page numbers', () => {
    const pages: PagePhrases[] = [
      {
        page: 3,
        phrases: [
          phrase('본 계약서는', 0.1, 0.8, 0.2),
          phrase('성명', 0.1, 0.2, 0.05),
          phrase('여백', 0.5, 0.2, 0.05),
          phrase('서명', 0.1, 0.1, 0.05),
        ],
      },
    ];
    const cands = phrasesToFieldCandidates(pages);
    expect(cands.map((c) => c.kind)).toEqual(['name', 'signature']);
    expect(cands.every((c) => c.page === 3)).toBe(true);
  });
});

describe('phrasesToFieldCandidates — representative forms', () => {
  it('form A — a signing block yields name/signature/date at expected spots', () => {
    // Bottom-of-page block, labels stacked on the left with a value column right.
    const pages: PagePhrases[] = [
      {
        page: 1,
        phrases: [
          phrase('성명', 0.1, 0.18, 0.05),
          phrase('서명', 0.1, 0.12, 0.05),
          phrase('작성일', 0.1, 0.06, 0.06),
        ],
      },
    ];
    const cands = phrasesToFieldCandidates(pages);
    expect(cands.map((c) => c.kind).sort()).toEqual(['date', 'name', 'signature']);

    const name = pick(cands, 'name');
    expect(name.type).toBe('TEXT');
    expect(name.rect.x).toBeCloseTo(0.1 + 0.05 + 0.01, 5);
    expect(centerY(name.rect)).toBeCloseTo(0.19, 5);

    const sign = pick(cands, 'signature');
    expect(sign.type).toBe('SIGNATURE');
    expect(centerY(sign.rect)).toBeCloseTo(0.13, 5);

    const date = pick(cands, 'date');
    expect(date.type).toBe('DATE');
    expect(date.rect.x).toBeCloseTo(0.1 + 0.06 + 0.01, 5);
    expect(centerY(date.rect)).toBeCloseTo(0.07, 5);
  });

  it('form B — an amount line with 금액 label and (인) seal', () => {
    const pages: PagePhrases[] = [
      {
        page: 2,
        phrases: [
          phrase('금액', 0.12, 0.5, 0.05),
          phrase('원', 0.55, 0.5, 0.03),
          phrase('(인)', 0.75, 0.2, 0.04),
        ],
      },
    ];
    const cands = phrasesToFieldCandidates(pages);
    // 금액 → amount (text), 원 → amount (text), (인) → signature seal
    expect(cands.map((c) => c.kind)).toEqual(['amount', 'amount', 'signature']);

    const amount = pick(cands, 'amount');
    expect(amount.type).toBe('TEXT');
    expect(amount.rect.x).toBeCloseTo(0.12 + 0.05 + 0.01, 5);

    const seal = pick(cands, 'signature');
    expect(seal.anchorText).toBe('(인)');
    expect(seal.type).toBe('SIGNATURE');
  });

  it('form C — an English-labeled form maps name/date/signature', () => {
    const pages: PagePhrases[] = [
      {
        page: 1,
        phrases: [
          phrase('Name', 0.1, 0.4, 0.08),
          phrase('Date', 0.1, 0.3, 0.08),
          phrase('Signature', 0.1, 0.2, 0.12),
        ],
      },
    ];
    const cands = phrasesToFieldCandidates(pages);
    expect(cands.map((c) => c.kind)).toEqual(['name', 'date', 'signature']);
    expect(cands.map((c) => c.type)).toEqual(['TEXT', 'DATE', 'SIGNATURE']);
  });
});
