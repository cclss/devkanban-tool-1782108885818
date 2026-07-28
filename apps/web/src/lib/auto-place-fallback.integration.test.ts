/**
 * Integration: auto-place failure → manual placement → save (grain-3).
 *
 * The pieces of the "실패 시 수동 흐름 보장" contract are each unit-tested in
 * isolation (auto-place.test.ts, wizard-fields-status.test.ts,
 * save-confirmed-only.test.ts). This test walks the WHOLE chain end-to-end over
 * the real modules — `autoPlaceFields` (orchestration), the candidate→draft
 * mapping, the wizard reducer + `canProceed` gate, and `saveFields` — with only
 * the two runtime edges stubbed: `./pdf` (the pdfjs loader) and `./api`/`./auth`
 * (the network). Nothing between them is mocked, so it reproduces the completion
 * criterion as the app actually runs it.
 *
 * It proves that on an anchor-less / scanned PDF the "자동으로 배치" action:
 *   1. returns zero recommendations without throwing (screen never breaks),
 *   2. leaves wizard state untouched (empty recommendation batch is a no-op),
 *   3. keeps "다음" locked until the user places a field manually, and
 *   4. lets the pre-existing manual place → save flow run unchanged.
 *
 * `./pdf` is mocked exactly as in auto-place.test.ts so the real extraction and
 * placement code runs over synthetic PDF-point geometry — no pdfjs, no real File.
 */

import { PdfRenderError } from './pdf';

jest.mock('./pdf', () => ({
  ...jest.requireActual('./pdf'),
  openPdf: jest.fn(),
}));
// The save path talks to the server through apiFetch; capture its payload
// instead of hitting the network. getToken is stubbed so send.ts stays offline.
jest.mock('./api', () => ({
  apiFetch: jest.fn(async () => ({ count: 0 })),
  apiDownload: jest.fn(),
}));
jest.mock('./auth', () => ({ getToken: () => 'tok' }));

import { autoPlaceFields } from './auto-place';
import { openPdf } from './pdf';
import { saveFields } from './send';
import { apiFetch } from './api';
import type { TextItemLike } from './pdf-text';
import {
  wizardReducer,
  canProceed,
  currentStepKey,
  confirmedFields,
  isRecommended,
  recommendedFieldsFromCandidates,
  initialWizardState,
  type WizardState,
  type SignFieldDraft,
} from '@/components/wizard/wizard-context';
import type { DocumentSummary } from './documents';

const mockOpenPdf = openPdf as jest.MockedFunction<typeof openPdf>;
const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const A4_W = 595;
const A4_H = 842;

/** Build a PDF-point text item: upright matrix, baseline origin at (x, baseline). */
function item(str: string, x: number, baseline: number, width: number, height = 12): TextItemLike {
  return { str, transform: [height, 0, 0, height, x, baseline], width, height };
}

/** A minimal pdfjs-document stub over `pagesItems` (one entry per page). */
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
const doc = { id: 'doc_1', title: '스캔본 계약서' } as unknown as DocumentSummary;

/** A wizard state parked on the 'fields' step (step 1 in the common sequence). */
function onFieldsStep(fields: SignFieldDraft[]): WizardState {
  return { ...initialWizardState, document: doc, step: 1, fields };
}

/**
 * Mirror of FieldsStep.runAutoPlace's data path: run auto-place, map results to
 * recommendation drafts, and apply them to wizard state. Returns the next state
 * plus the count that drives the inline notice (`> 0` → "placed", else the
 * "직접 배치해 주세요" guidance — the screen stays on manual placement either way).
 * Uses the real modules; only the id minting is a deterministic stub.
 */
async function runAutoPlace(state: WizardState, file: File) {
  let seq = 0;
  const candidates = await autoPlaceFields(file);
  const drafts = recommendedFieldsFromCandidates(candidates, () => `rec_${(seq += 1)}`);
  const next = wizardReducer(state, { type: 'ADD_RECOMMENDED_FIELDS', fields: drafts });
  return { next, drafts };
}

let idCounter = 0;
const manualId = () => `manual_${(idCounter += 1)}`;

afterEach(() => jest.clearAllMocks());

describe('auto-place degrades to zero recommendations (screen never breaks)', () => {
  it('scanned / text-layer-less PDF (pages yield no items) → []', async () => {
    const { doc: stub } = stubDoc([[], []]);
    mockOpenPdf.mockResolvedValue(resolveWith(stub));
    await expect(autoPlaceFields(anyFile)).resolves.toEqual([]);
  });

  it('text PDF with no anchor phrases → []', async () => {
    const { doc: stub } = stubDoc([[item('hello world', 100, 700, 60)]]);
    mockOpenPdf.mockResolvedValue(resolveWith(stub));
    await expect(autoPlaceFields(anyFile)).resolves.toEqual([]);
  });

  it('unreadable / non-PDF file → [] without throwing', async () => {
    mockOpenPdf.mockRejectedValue(new PdfRenderError());
    await expect(autoPlaceFields(anyFile)).resolves.toEqual([]);
  });
});

describe('failure → manual → save flow on an anchor-less PDF', () => {
  it('auto-place adds nothing, then manual placement saves normally', async () => {
    // A scanned PDF: two pages, no text layer, so auto-place finds nothing.
    const { doc: stub, destroy } = stubDoc([[], []]);
    mockOpenPdf.mockResolvedValue(resolveWith(stub));

    // 1. User opens the fields step with an empty canvas and clicks "자동으로 배치".
    let state = onFieldsStep([]);
    const { next: afterAuto, drafts } = await runAutoPlace(state, anyFile);

    // 2. Zero recommendations → the "직접 배치해 주세요" guidance branch, not an
    //    error. The opened document was still freed.
    expect(drafts).toEqual([]);
    expect(destroy).toHaveBeenCalledTimes(1);

    // 3. Screen not broken: an empty batch is a no-op — same state reference, no
    //    fields materialized, still parked on the fields step.
    expect(afterAuto).toBe(state);
    expect(afterAuto.fields).toEqual([]);
    expect(currentStepKey(afterAuto)).toBe('fields');
    expect(afterAuto.fields.some(isRecommended)).toBe(false);

    // 4. "다음" stays locked with no confirmed fields.
    expect(canProceed(afterAuto)).toBe(false);

    // 5. Manual placement: the user drops a signature field. It carries no
    //    `status`, so it is confirmed immediately (manual flow unchanged).
    const manual: SignFieldDraft = {
      id: manualId(), type: 'SIGNATURE', page: 1,
      x: 0.4, y: 0.55, width: 0.2, height: 0.05, recipientIndex: 0,
    };
    state = wizardReducer(afterAuto, { type: 'SET_FIELDS', fields: [manual] });
    expect(confirmedFields(state.fields)).toHaveLength(1);
    expect(canProceed(state)).toBe(true);

    // 6. Saving persists the manually placed field through the real save path.
    await saveFields('doc_1', state.fields, 'tok');
    const body = mockApiFetch.mock.calls[0]![1]!.json as { fields: { type: string }[] };
    expect(body.fields).toHaveLength(1);
    expect(body.fields[0]!.type).toBe('SIGNATURE');
  });

  it('a spurious auto-place run mid-way never disturbs already-placed manual fields', async () => {
    // User has already placed a field manually, then clicks auto-place on a PDF
    // that yields nothing. The existing field must survive untouched.
    const { doc: stub } = stubDoc([[item('lorem ipsum', 80, 500, 90)]]);
    mockOpenPdf.mockResolvedValue(resolveWith(stub));

    const manual: SignFieldDraft = {
      id: manualId(), type: 'DATE', page: 1,
      x: 0.3, y: 0.3, width: 0.2, height: 0.05, recipientIndex: 0,
    };
    const state = onFieldsStep([manual]);
    const { next, drafts } = await runAutoPlace(state, anyFile);

    expect(drafts).toEqual([]);
    expect(next).toBe(state);
    expect(next.fields).toEqual([manual]);
    expect(canProceed(next)).toBe(true);
  });
});
