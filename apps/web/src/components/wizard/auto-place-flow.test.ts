/**
 * End-to-end auto-place data flow (grain-5, DOM-free tier).
 *
 * Stitches together the pieces each earlier grain shipped in isolation and drives
 * the completion criterion at the data layer, one real PDF-shaped fixture end to
 * end:
 *
 *   autoPlaceFields(file)            (grain-2, over mocked pdfjs)
 *     → recommendedFieldsFromCandidates                (grain-3 mapping)
 *     → reducer ADD_RECOMMENDED_FIELDS                 (state injection)
 *     → recommendations render out of the save set / gate  (isRecommended/confirmedFields)
 *     → ACCEPT_FIELD / ACCEPT_ALL_RECOMMENDED          (user 수락)
 *     → confirmedFields + saveFields payload            (기존 저장 흐름)
 *
 * plus the no-anchor safety net: a PDF with no anchor phrases yields `[]`, the
 * injection is a no-op (state untouched, never throws), and manual placement
 * still confirms and saves. `./pdf` is mocked exactly as in auto-place.test.ts so
 * the real extraction + placement + reducer + save code all run unmodified.
 */

import { PdfRenderError } from '@/lib/pdf';

jest.mock('@/lib/pdf', () => ({
  ...jest.requireActual('@/lib/pdf'),
  openPdf: jest.fn(),
}));

// The save path posts through apiFetch; capture the outgoing payload.
jest.mock('@/lib/api', () => ({
  apiFetch: jest.fn(async () => ({ count: 0 })),
  apiDownload: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({ getToken: () => 'tok' }));

import { autoPlaceFields } from '@/lib/auto-place';
import { openPdf } from '@/lib/pdf';
import { saveFields } from '@/lib/send';
import { apiFetch } from '@/lib/api';
import type { TextItemLike } from '@/lib/pdf-text';
import {
  wizardReducer,
  recommendedFieldsFromCandidates,
  confirmedFields,
  canProceed,
  isRecommended,
  isConfirmed,
  initialWizardState,
  type WizardState,
  type SignFieldDraft,
} from './wizard-context';

const mockOpenPdf = openPdf as jest.MockedFunction<typeof openPdf>;
const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const A4_W = 595;
const A4_H = 842;

/** PDF-point text item: upright matrix, baseline origin at (x, baseline). */
function item(str: string, x: number, baseline: number, width: number, height = 12): TextItemLike {
  return { str, transform: [height, 0, 0, height, x, baseline], width, height };
}

function stubDoc(pagesItems: TextItemLike[][]) {
  const destroy = jest.fn(() => Promise.resolve());
  const doc = {
    numPages: pagesItems.length,
    getPage: async (n: number) => ({
      view: [0, 0, A4_W, A4_H] as [number, number, number, number],
      getTextContent: async () => ({ items: pagesItems[n - 1] ?? [] }),
      cleanup: () => {},
    }),
    destroy,
  };
  return { doc, destroy };
}

function resolveWith(doc: ReturnType<typeof stubDoc>['doc']) {
  return { doc, pageCount: doc.numPages } as unknown as Awaited<ReturnType<typeof openPdf>>;
}

const anyFile = {} as File;

/** Deterministic id generator standing in for the canvas's `nextFieldId`. */
function idGen() {
  let n = 0;
  return () => `rec-${(n += 1)}`;
}

/** A wizard state parked on the 'fields' step (step 1 in the common sequence). */
function onFieldsStep(fields: SignFieldDraft[] = []): WizardState {
  return { ...initialWizardState, step: 1, file: anyFile, fields };
}

afterEach(() => jest.clearAllMocks());

describe('auto-place → recommend → accept → save (happy path)', () => {
  it('injects recommendations that stay out of the gate/save until accepted, then persists on accept', async () => {
    // A text PDF carrying real anchor phrases on two pages.
    const { doc } = stubDoc([
      [item('서명', 100, 700, 24), item('날짜', 100, 660, 24)],
      [item('금액', 100, 600, 24), item('1,000,000', 140, 600, 60), item('원', 210, 600, 12)],
    ]);
    mockOpenPdf.mockResolvedValue(resolveWith(doc));

    // 1) 자동 배치 실행 — orchestration returns candidates (never throws).
    const candidates = await autoPlaceFields(anyFile);
    expect(candidates.length).toBeGreaterThan(0);

    // 2) 상태 주입 — map to recommended drafts, dispatch into wizard state.
    const drafts = recommendedFieldsFromCandidates(candidates, idGen());
    let state = onFieldsStep([]);
    state = wizardReducer(state, { type: 'ADD_RECOMMENDED_FIELDS', fields: drafts });

    // 3) 추천 표시 — every injected field is a recommendation, none confirmed yet,
    //    so the '다음' gate stays locked and no field is a save target.
    expect(state.fields).toHaveLength(drafts.length);
    expect(state.fields.every(isRecommended)).toBe(true);
    expect(confirmedFields(state.fields)).toHaveLength(0);
    expect(canProceed(state)).toBe(false);

    // 4) 개별 수락 — one recommendation becomes confirmed; the rest stay recommended.
    const firstId = state.fields[0]!.id;
    state = wizardReducer(state, { type: 'ACCEPT_FIELD', id: firstId });
    expect(state.fields.find((f) => f.id === firstId)!.status).toBe('confirmed');
    expect(confirmedFields(state.fields)).toHaveLength(1);
    expect(canProceed(state)).toBe(true); // one accepted field unlocks the step.

    // 5) 모두 수락 — remaining recommendations promote; the whole set is confirmed.
    state = wizardReducer(state, { type: 'ACCEPT_ALL_RECOMMENDED' });
    expect(state.fields.every(isConfirmed)).toBe(true);

    // 6) 확정 저장 — the existing save flow persists exactly the confirmed set.
    await saveFields('doc_1', state.fields, 'tok');
    const body = mockApiFetch.mock.calls[0]![1]!.json as { fields: unknown[] };
    expect(body.fields).toHaveLength(state.fields.length);
  });

  it('persists only accepted recommendations, dropping the ones left unaccepted', async () => {
    const { doc } = stubDoc([
      [item('서명', 100, 700, 24), item('이름', 100, 660, 24), item('날짜', 100, 620, 24)],
    ]);
    mockOpenPdf.mockResolvedValue(resolveWith(doc));

    const drafts = recommendedFieldsFromCandidates(await autoPlaceFields(anyFile), idGen());
    expect(drafts.length).toBeGreaterThanOrEqual(2);

    let state = wizardReducer(onFieldsStep([]), {
      type: 'ADD_RECOMMENDED_FIELDS',
      fields: drafts,
    });
    // Accept the first, delete the second, leave the rest recommended.
    state = wizardReducer(state, { type: 'ACCEPT_FIELD', id: drafts[0]!.id });
    state = wizardReducer(state, { type: 'REMOVE_FIELD', id: drafts[1]!.id });

    await saveFields('doc_1', state.fields, 'tok');
    const body = mockApiFetch.mock.calls[0]![1]!.json as { fields: unknown[] };
    // Only the single accepted field reaches the server — deleted + still-
    // recommended fields never persist.
    expect(body.fields).toHaveLength(1);
  });
});

describe('no-anchor safety net', () => {
  it('an anchor-less PDF yields [] and a no-op injection — state is untouched and never throws', async () => {
    const { doc } = stubDoc([[item('hello world', 100, 700, 60)]]);
    mockOpenPdf.mockResolvedValue(resolveWith(doc));

    const candidates = await autoPlaceFields(anyFile);
    expect(candidates).toEqual([]);

    const drafts = recommendedFieldsFromCandidates(candidates, idGen());
    const start = onFieldsStep([]);
    const next = wizardReducer(start, { type: 'ADD_RECOMMENDED_FIELDS', fields: drafts });
    // Empty batch is a same-reference no-op — the screen has nothing to render
    // and nothing changed underneath it.
    expect(next).toBe(start);
    expect(next.fields).toHaveLength(0);
  });

  it('a corrupt / non-PDF file degrades to [] without throwing, leaving manual placement fully working', async () => {
    mockOpenPdf.mockRejectedValue(new PdfRenderError());

    await expect(autoPlaceFields(anyFile)).resolves.toEqual([]);

    // Manual placement carries on: drop a field by hand, confirm it, save it.
    const manual: SignFieldDraft = {
      id: 'm1', type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.26, height: 0.08,
    };
    const state = wizardReducer(onFieldsStep([]), { type: 'SET_FIELDS', fields: [manual] });
    // A manually placed field has no status → counts as confirmed, unlocks '다음'.
    expect(canProceed(state)).toBe(true);
    expect(state.fields).toEqual([manual]);

    await saveFields('doc_1', state.fields, 'tok');
    const body = mockApiFetch.mock.calls[0]![1]!.json as { fields: unknown[] };
    expect(body.fields).toHaveLength(1);
  });
});
