/**
 * Representative-form placement tests (design-spec §7, A10 — full layouts).
 *
 * The sibling `field-anchors.test.ts` pins the per-rule behaviour (A1–A10) with
 * one phrase per page. This file exercises the *whole* pipeline on synthetic
 * `PagePhrases` that mimic a real contract page: a title, party lines and other
 * body text (all non-anchors) interleaved with the four label kinds — 서명 /
 * 날짜 / 이름 / 금액 — laid out top-to-bottom in normalized PDF space.
 *
 * For every form we assert `suggestFields` yields exactly one candidate per
 * intended anchor (noise produces none), each with the right category+type, a
 * valid in-page NormRect, and a box placed next to its own anchor (right when
 * there is room, below when the label hugs the right margin). No-anchor forms
 * return `[]` without throwing.
 */

import { suggestFields, type FieldCandidate, type AnchorCategory } from './field-anchors';
import { type NormRect, type SignFieldType } from './field-geometry';
import type { PagePhrases, Phrase } from './pdf-text';

const EPS = 0.001;

function phrase(text: string, rect: NormRect, page = 1): Phrase {
  return { text, page, rect };
}

/** A NormRect is a valid, non-overflowing in-page box. */
function expectInPage(rect: NormRect): void {
  expect(rect.x).toBeGreaterThanOrEqual(-EPS);
  expect(rect.y).toBeGreaterThanOrEqual(-EPS);
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(1 + EPS);
  expect(rect.y + rect.height).toBeLessThanOrEqual(1 + EPS);
}

/** Candidate sits to the right of its anchor, vertically centered on the line. */
function expectRightOf(cand: NormRect, anchor: NormRect): void {
  expect(cand.x).toBeGreaterThanOrEqual(anchor.x + anchor.width - EPS);
  const candMid = cand.y + cand.height / 2;
  const anchorMid = anchor.y + anchor.height / 2;
  expect(candMid).toBeCloseTo(anchorMid, 6);
}

/** Candidate sits below its anchor (top edge under the anchor bottom, same column). */
function expectBelow(cand: NormRect, anchor: NormRect): void {
  expect(cand.y + cand.height).toBeLessThanOrEqual(anchor.y + EPS);
  // clamp only ever pulls x left when the default box would overflow the right
  // margin, so the field stays in the anchor's column: at or left of the anchor.
  expect(cand.x).toBeLessThanOrEqual(anchor.x + EPS);
  expect(cand.x).toBeGreaterThanOrEqual(anchor.x - cand.width - EPS);
}

/** One intended anchor in a form fixture, with what it should produce. */
interface AnchorSpec {
  text: string;
  rect: NormRect;
  category: AnchorCategory;
  type: SignFieldType;
  placement: 'right' | 'below';
  page?: number;
}

/** A whole synthetic form: intended anchors + non-anchor noise phrases. */
interface Form {
  label: string;
  anchors: AnchorSpec[];
  /** Body text that must classify to nothing (title, parties, clauses…). */
  noise: Phrase[];
}

function pagesForForm(form: Form): PagePhrases[] {
  const byPage = new Map<number, Phrase[]>();
  const push = (p: Phrase) => {
    const list = byPage.get(p.page) ?? [];
    list.push(p);
    byPage.set(p.page, list);
  };
  for (const a of form.anchors) push(phrase(a.text, a.rect, a.page ?? 1));
  for (const n of form.noise) push(n);
  return [...byPage.keys()]
    .sort((x, y) => x - y)
    .map((page) => ({ page, phrases: byPage.get(page)! }));
}

/** Find the single candidate produced by a given anchor phrase (unique text). */
function candidateFor(out: FieldCandidate[], text: string): FieldCandidate {
  const hits = out.filter((c) => c.anchorText === text);
  expect(hits).toHaveLength(1);
  return hits[0]!;
}

// --- Representative forms ----------------------------------------------------

const FORMS: Form[] = [
  {
    label: '표준 근로계약서 (좌측 라벨 — 모두 우측 배치)',
    anchors: [
      {
        text: '성명',
        rect: { x: 0.1, y: 0.75, width: 0.08, height: 0.03 },
        category: 'NAME',
        type: 'TEXT',
        placement: 'right',
      },
      {
        text: '작성일',
        rect: { x: 0.1, y: 0.6, width: 0.1, height: 0.03 },
        category: 'DATE',
        type: 'DATE',
        placement: 'right',
      },
      {
        text: '금액 3,000,000 원',
        rect: { x: 0.1, y: 0.5, width: 0.24, height: 0.03 },
        category: 'AMOUNT',
        type: 'TEXT',
        placement: 'right',
      },
      {
        text: '서명',
        rect: { x: 0.1, y: 0.35, width: 0.08, height: 0.03 },
        category: 'SIGN',
        type: 'SIGNATURE',
        placement: 'right',
      },
    ],
    noise: [
      phrase('근로 계약서', { x: 0.4, y: 0.92, width: 0.2, height: 0.04 }),
      phrase('갑 (사용자)', { x: 0.1, y: 0.85, width: 0.2, height: 0.03 }),
      phrase('본 계약은 다음과 같이 체결한다', { x: 0.1, y: 0.2, width: 0.6, height: 0.03 }),
    ],
  },
  {
    label: '영문 용역계약서 (English labels)',
    anchors: [
      {
        text: 'Full Name',
        rect: { x: 0.1, y: 0.7, width: 0.12, height: 0.03 },
        category: 'NAME',
        type: 'TEXT',
        placement: 'right',
      },
      {
        text: 'Date',
        rect: { x: 0.1, y: 0.6, width: 0.08, height: 0.03 },
        category: 'DATE',
        type: 'DATE',
        placement: 'right',
      },
      {
        text: 'Amount',
        rect: { x: 0.1, y: 0.5, width: 0.1, height: 0.03 },
        category: 'AMOUNT',
        type: 'TEXT',
        placement: 'right',
      },
      {
        text: 'Signature',
        rect: { x: 0.1, y: 0.4, width: 0.12, height: 0.03 },
        category: 'SIGN',
        type: 'SIGNATURE',
        placement: 'right',
      },
    ],
    noise: [
      phrase('SERVICE AGREEMENT', { x: 0.35, y: 0.9, width: 0.3, height: 0.04 }),
      phrase('Please review carefully.', { x: 0.1, y: 0.25, width: 0.4, height: 0.03 }),
    ],
  },
  {
    label: '영수증 (금액은 우측 margin → 아래 배치, 날인은 우측)',
    anchors: [
      {
        text: '성명',
        rect: { x: 0.1, y: 0.7, width: 0.08, height: 0.03 },
        category: 'NAME',
        type: 'TEXT',
        placement: 'right',
      },
      {
        text: '날짜',
        rect: { x: 0.1, y: 0.6, width: 0.08, height: 0.03 },
        category: 'DATE',
        type: 'DATE',
        placement: 'right',
      },
      {
        text: '합계 150,000 원',
        rect: { x: 0.75, y: 0.4, width: 0.22, height: 0.03 },
        category: 'AMOUNT',
        type: 'TEXT',
        placement: 'below',
      },
      {
        text: '(인)',
        rect: { x: 0.6, y: 0.2, width: 0.05, height: 0.03 },
        category: 'SIGN',
        type: 'SIGNATURE',
        placement: 'right',
      },
    ],
    noise: [
      phrase('영수증', { x: 0.45, y: 0.9, width: 0.1, height: 0.04 }),
      phrase('아래와 같이 영수함', { x: 0.1, y: 0.5, width: 0.3, height: 0.03 }),
    ],
  },
  {
    label: '다중 페이지 계약서 (p1 이름·날짜, p2 금액·서명)',
    anchors: [
      {
        text: '성함',
        rect: { x: 0.12, y: 0.7, width: 0.08, height: 0.03 },
        category: 'NAME',
        type: 'TEXT',
        placement: 'right',
        page: 1,
      },
      {
        text: '계약일',
        rect: { x: 0.12, y: 0.6, width: 0.1, height: 0.03 },
        category: 'DATE',
        type: 'DATE',
        placement: 'right',
        page: 1,
      },
      {
        text: '공급가액 500,000',
        rect: { x: 0.1, y: 0.55, width: 0.26, height: 0.03 },
        category: 'AMOUNT',
        type: 'TEXT',
        placement: 'right',
        page: 2,
      },
      {
        text: '날인',
        rect: { x: 0.1, y: 0.35, width: 0.08, height: 0.03 },
        category: 'SIGN',
        type: 'SIGNATURE',
        placement: 'right',
        page: 2,
      },
    ],
    noise: [
      phrase('제1조 (목적)', { x: 0.1, y: 0.85, width: 0.2, height: 0.03 }, 1),
      phrase('제2조 (대금)', { x: 0.1, y: 0.85, width: 0.2, height: 0.03 }, 2),
    ],
  },
];

describe('suggestFields — representative full-form layouts (A10)', () => {
  it.each(FORMS)('$label', (form) => {
    const out = suggestFields(pagesForForm(form));

    // Exactly the intended anchors produce candidates; noise produces none.
    expect(out).toHaveLength(form.anchors.length);

    // All four field kinds are represented across the form.
    const categories = new Set(out.map((c) => c.category));
    for (const a of form.anchors) expect(categories.has(a.category)).toBe(true);

    for (const a of form.anchors) {
      const cand = candidateFor(out, a.text);
      expect(cand.category).toBe(a.category);
      expect(cand.type).toBe(a.type);
      expect(cand.page).toBe(a.page ?? 1);
      expectInPage(cand.rect);
      if (a.placement === 'right') expectRightOf(cand.rect, a.rect);
      else expectBelow(cand.rect, a.rect);
    }
  });

  it('covers all four categories at least once across the fixtures', () => {
    const seen = new Set<AnchorCategory>();
    for (const form of FORMS) {
      for (const c of suggestFields(pagesForForm(form))) seen.add(c.category);
    }
    expect([...seen].sort()).toEqual<AnchorCategory[]>(['AMOUNT', 'DATE', 'NAME', 'SIGN']);
  });
});

// --- No-anchor forms: safe empty result, no throw ---------------------------

describe('suggestFields — anchor-less forms are safe (A9)', () => {
  const noAnchorForms: { label: string; pages: PagePhrases[] }[] = [
    {
      label: '표지만 있는 PDF (앵커 문구 없음)',
      pages: [
        {
          page: 1,
          phrases: [
            phrase('제목입니다', { x: 0.3, y: 0.8, width: 0.4, height: 0.05 }),
            phrase('본문 내용 텍스트', { x: 0.1, y: 0.6, width: 0.5, height: 0.03 }),
            phrase('감사합니다', { x: 0.1, y: 0.3, width: 0.2, height: 0.03 }),
          ],
        },
      ],
    },
    {
      label: '여러 페이지 모두 앵커 없음',
      pages: [
        { page: 1, phrases: [phrase('개요', { x: 0.1, y: 0.9, width: 0.1, height: 0.04 })] },
        { page: 2, phrases: [phrase('세부 사항 설명', { x: 0.1, y: 0.9, width: 0.3, height: 0.03 })] },
        { page: 3, phrases: [] }, // scanned / text-less page
      ],
    },
    {
      label: '완전히 빈 입력',
      pages: [],
    },
  ];

  it.each(noAnchorForms)('$label → [] without throwing', ({ pages }) => {
    let out: FieldCandidate[] = [];
    expect(() => {
      out = suggestFields(pages);
    }).not.toThrow();
    expect(out).toEqual([]);
  });
});
