/**
 * Pure tests for the candidate→draft adapter, plus the auto-placement
 * orchestration's *fallback* contract (grain-2).
 *
 * The pure adapter {@link candidatesToSuggestions} is pinned for:
 *   • shape — a candidate's `NormRect` spreads into `x`/`y`/`width`/`height`,
 *     with no `id` and no `recipientIndex`,
 *   • dedup — a candidate is dropped only when an existing confirmed field
 *     shares its page and type AND sits on the same spot; a different page,
 *     different type, or a far-away box of the same type all keep it,
 *   • empty candidates — the "found nothing / failed" path leaves every
 *     existing field untouched (auto-placement never mutates the manual flow).
 *
 * The orchestration half {@link autoPlaceFields} is verified for its fallback
 * guarantees only — the actual pdfjs I/O is out of scope, so `openPdf`,
 * `extractPagePhrases`, and `phrasesToFieldCandidates` are module-mocked:
 *   • no anchors → `[]` (a blank page must not crash or invent fields),
 *   • extraction throws → the error propagates AND `doc.destroy()` still runs,
 *     so a mid-flight failure never leaks the pdfjs worker handle.
 */

import {
  autoPlaceFields,
  candidatesToSuggestions,
  type FieldSuggestion,
} from './field-candidates';
import type { FieldCandidate } from './field-anchors';
import type { SignFieldDraft } from '@/components/wizard/wizard-context';
import { openPdf } from './pdf';
import { extractPagePhrases } from './pdf-text';
import { phrasesToFieldCandidates } from './field-anchors';

// Auto-placement is a wiring layer over three pure/I-O modules; mock all three
// so the fallback behaviour can be driven deterministically without touching
// pdfjs. (`field-anchors` also re-exports `FieldCandidate`, a type erased at
// compile time, so mocking the module doesn't disturb the pure tests above.)
jest.mock('./pdf');
jest.mock('./pdf-text');
jest.mock('./field-anchors');

const openPdfMock = openPdf as jest.MockedFunction<typeof openPdf>;
const extractPagePhrasesMock = extractPagePhrases as jest.MockedFunction<
  typeof extractPagePhrases
>;
const phrasesToFieldCandidatesMock =
  phrasesToFieldCandidates as jest.MockedFunction<typeof phrasesToFieldCandidates>;

function candidate(
  over: Partial<FieldCandidate> & Pick<FieldCandidate, 'type' | 'page'>,
): FieldCandidate {
  return {
    kind: 'signature',
    anchorText: '서명',
    rect: { x: 0.1, y: 0.1, width: 0.26, height: 0.08 },
    ...over,
  };
}

function field(over: Partial<SignFieldDraft> & Pick<SignFieldDraft, 'type' | 'page'>): SignFieldDraft {
  return {
    id: 'f1',
    x: 0.1,
    y: 0.1,
    width: 0.26,
    height: 0.08,
    ...over,
  };
}

describe('candidatesToSuggestions — shape', () => {
  it('spreads the rect and omits id / recipientIndex', () => {
    const cands = [
      candidate({ type: 'SIGNATURE', page: 2, rect: { x: 0.2, y: 0.3, width: 0.26, height: 0.08 } }),
    ];
    const [s] = candidatesToSuggestions(cands, []);
    expect(s).toEqual<FieldSuggestion>({
      type: 'SIGNATURE',
      page: 2,
      x: 0.2,
      y: 0.3,
      width: 0.26,
      height: 0.08,
    });
    expect('id' in s!).toBe(false);
    expect('recipientIndex' in s!).toBe(false);
  });

  it('preserves order and passes every candidate through when there are no existing fields', () => {
    const cands = [
      candidate({ type: 'SIGNATURE', page: 1 }),
      candidate({ type: 'DATE', page: 1, rect: { x: 0.5, y: 0.5, width: 0.18, height: 0.05 } }),
      candidate({ type: 'TEXT', page: 2, rect: { x: 0.1, y: 0.9, width: 0.28, height: 0.06 } }),
    ];
    const out = candidatesToSuggestions(cands, []);
    expect(out.map((s) => [s.type, s.page])).toEqual([
      ['SIGNATURE', 1],
      ['DATE', 1],
      ['TEXT', 2],
    ]);
  });
});

describe('candidatesToSuggestions — dedup', () => {
  it('drops a candidate that overlaps an existing field of the same page and type', () => {
    const cands = [candidate({ type: 'SIGNATURE', page: 1, rect: { x: 0.1, y: 0.1, width: 0.26, height: 0.08 } })];
    const existing = [field({ type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.26, height: 0.08 })];
    expect(candidatesToSuggestions(cands, existing)).toEqual([]);
  });

  it('keeps a candidate when the existing field is on a different page', () => {
    const cands = [candidate({ type: 'SIGNATURE', page: 1 })];
    const existing = [field({ type: 'SIGNATURE', page: 2 })];
    expect(candidatesToSuggestions(cands, existing)).toHaveLength(1);
  });

  it('keeps a candidate when the existing field is a different type at the same spot', () => {
    const cands = [candidate({ type: 'SIGNATURE', page: 1 })];
    const existing = [field({ type: 'DATE', page: 1 })];
    expect(candidatesToSuggestions(cands, existing)).toHaveLength(1);
  });

  it('keeps a same-type candidate that sits far from the existing field', () => {
    const cands = [candidate({ type: 'TEXT', page: 1, rect: { x: 0.1, y: 0.1, width: 0.28, height: 0.06 } })];
    const existing = [field({ type: 'TEXT', page: 1, x: 0.6, y: 0.7, width: 0.28, height: 0.06 })];
    expect(candidatesToSuggestions(cands, existing)).toHaveLength(1);
  });

  it('treats a small offset within proximity as a duplicate', () => {
    const cands = [candidate({ type: 'DATE', page: 3, rect: { x: 0.30, y: 0.40, width: 0.18, height: 0.05 } })];
    // existing centered ~0.02 away on each axis — inside DEDUP_PROXIMITY (0.05)
    const existing = [field({ type: 'DATE', page: 3, x: 0.32, y: 0.42, width: 0.18, height: 0.05 })];
    expect(candidatesToSuggestions(cands, existing)).toEqual([]);
  });

  it('drops only the colliding candidate, keeping others', () => {
    const cands = [
      candidate({ type: 'SIGNATURE', page: 1, rect: { x: 0.1, y: 0.1, width: 0.26, height: 0.08 } }),
      candidate({ type: 'SIGNATURE', page: 1, rect: { x: 0.6, y: 0.8, width: 0.26, height: 0.08 } }),
    ];
    const existing = [field({ type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.26, height: 0.08 })];
    const out = candidatesToSuggestions(cands, existing);
    expect(out).toHaveLength(1);
    expect(out[0]!.x).toBeCloseTo(0.6, 5);
  });
});

describe('candidatesToSuggestions — empty candidates (auto-placement found nothing)', () => {
  it('yields no suggestions and leaves the existing fields untouched', () => {
    const existing: SignFieldDraft[] = [
      field({ type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.26, height: 0.08 }),
      field({ id: 'f2', type: 'DATE', page: 2, x: 0.5, y: 0.6, width: 0.18, height: 0.05 }),
    ];
    const snapshot = JSON.parse(JSON.stringify(existing));

    expect(candidatesToSuggestions([], existing)).toEqual([]);
    // The manual flow's fields must survive an empty auto-placement byte-for-byte.
    expect(existing).toEqual(snapshot);
  });
});

describe('autoPlaceFields — fallback (no anchors / mid-flight failure)', () => {
  /** A pdfjs document stub exposing only the `destroy` the orchestrator calls. */
  function fakeDoc() {
    const destroy = jest.fn().mockResolvedValue(undefined);
    // The real handle is a large pdfjs type; only `destroy` is exercised here.
    const doc = { destroy } as unknown as Awaited<
      ReturnType<typeof openPdf>
    >['doc'];
    return { doc, destroy };
  }

  const file = new File([new Uint8Array([1, 2, 3])], 'contract.pdf', {
    type: 'application/pdf',
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty list when the document has no matchable anchors', async () => {
    const { doc, destroy } = fakeDoc();
    openPdfMock.mockResolvedValue({ doc, pageCount: 1 });
    extractPagePhrasesMock.mockResolvedValue([]);
    phrasesToFieldCandidatesMock.mockReturnValue([]);

    await expect(autoPlaceFields(file)).resolves.toEqual([]);
    // Even on the "found nothing" path the worker handle is released.
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('propagates an extraction failure while still destroying the document', async () => {
    const { doc, destroy } = fakeDoc();
    const boom = new Error('extract exploded');
    openPdfMock.mockResolvedValue({ doc, pageCount: 3 });
    extractPagePhrasesMock.mockRejectedValue(boom);

    await expect(autoPlaceFields(file)).rejects.toBe(boom);
    // `finally` runs on the error path — no leaked pdfjs worker resources.
    expect(destroy).toHaveBeenCalledTimes(1);
    // Matching never runs once extraction has thrown.
    expect(phrasesToFieldCandidatesMock).not.toHaveBeenCalled();
  });
});
