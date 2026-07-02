/**
 * @jest-environment jsdom
 */

/**
 * Wiring contract: `fields-step` feeds AI `analyzeDocument` results into the
 * exact same editable field list the canvas renders and mutates — no separate
 * "auto" channel, no provenance marker.
 *
 * The step maps each server `AnalyzedField` through `nextFieldId` (minting only a
 * client id, trusting the server geometry verbatim) and dispatches them into
 * wizard state, which is the single `fields` array handed to `FieldCanvas`. Here
 * the canvas is replaced by a prop-capturing stub so we can assert (a) the
 * injected drafts land in `FieldCanvas.fields` with a minted id and the plain
 * `SignFieldDraft` shape (no `origin`/`source`), and (b) an edit pushed back
 * through `onFieldsChange` updates that very list — i.e. auto fields are editable
 * through the shared path, identical to manual ones.
 */

import * as React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { FieldsStep } from './fields-step';
import { WizardProvider, useWizard, type SignFieldDraft } from './wizard-context';
import type { DocumentSummary } from '@/lib/documents';

jest.mock('@repo/ui', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}));

const analyzeDocument = jest.fn();
jest.mock('@/lib/documents', () => ({
  __esModule: true,
  analyzeDocument: (...args: unknown[]) => analyzeDocument(...args),
  // Any non-null source lets the step render; the canvas is stubbed anyway.
  documentRenderSource: () => ({ kind: 'file', file: {} }),
}));

// Capture the props the step hands the canvas — this stub stands in for the real
// FieldCanvas so the test observes exactly the list the canvas would edit. The
// real `nextFieldId`/`FIELD_DND_TYPE` are kept (the step mints ids with them).
let canvasProps: { fields: SignFieldDraft[]; onFieldsChange: (f: SignFieldDraft[]) => void } | null =
  null;
jest.mock('./field-canvas', () => {
  const actual = jest.requireActual('./field-canvas');
  return {
    ...actual,
    FieldCanvas: (props: {
      fields: SignFieldDraft[];
      onFieldsChange: (f: SignFieldDraft[]) => void;
    }) => {
      canvasProps = props;
      return <div data-testid="field-canvas" />;
    },
  };
});

const ANALYZED = [
  { type: 'SIGNATURE' as const, page: 1, x: 0.12, y: 0.62, width: 0.26, height: 0.08, recipientIndex: 0 },
  { type: 'DATE' as const, page: 2, x: 0.4, y: 0.2, width: 0.18, height: 0.05, recipientIndex: 1 },
  { type: 'TEXT' as const, page: 1, x: 0.55, y: 0.33, width: 0.28, height: 0.06, recipientIndex: 0 },
];

function doc(id = 'doc-1'): DocumentSummary {
  return {
    id,
    title: '계약서',
    status: 'DRAFT',
    statusLabel: '작성 중',
    pageCount: 2,
    recipientCount: 0,
    sentAt: null,
    createdAt: '2026-07-02T00:00:00.000Z',
    completedAt: null,
    downloadsReady: false,
  };
}

/** Seed the wizard with an uploaded document so the field step actually mounts. */
function Seed() {
  const { dispatch } = useWizard();
  React.useEffect(() => {
    dispatch({ type: 'SET_DOCUMENT', document: doc(), file: { name: 'c.pdf' } as unknown as File });
  }, [dispatch]);
  return <FieldsStep />;
}

function renderStep() {
  return render(
    <WizardProvider>
      <Seed />
    </WizardProvider>,
  );
}

beforeAll(() => {
  // useIsDesktop → matchMedia; report desktop so the placement surface renders.
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

beforeEach(() => {
  canvasProps = null;
  analyzeDocument.mockReset();
});

describe('fields-step feeds analyzed fields into the canvas edit list', () => {
  it('maps analyzeDocument results through nextFieldId into FieldCanvas.fields', async () => {
    analyzeDocument.mockResolvedValue({
      fields: ANALYZED,
      meta: { source: 'ai', analyzedAt: '2026-07-02T00:00:00.000Z', fieldCount: ANALYZED.length },
    });

    renderStep();

    await waitFor(() => expect(canvasProps?.fields).toHaveLength(ANALYZED.length));
    expect(analyzeDocument).toHaveBeenCalledTimes(1);
    expect(analyzeDocument).toHaveBeenCalledWith('doc-1');

    const injected = canvasProps!.fields;
    injected.forEach((draft, i) => {
      // Server geometry trusted verbatim; only a client id is minted.
      expect(draft.id).toMatch(/^field-\d+-\d+$/);
      expect(draft).toMatchObject(ANALYZED[i]!);
      // Exactly the SignFieldDraft shape — no origin/source/provenance marker
      // that any edit path could branch on.
      expect(Object.keys(draft).sort()).toEqual(
        ['height', 'id', 'page', 'recipientIndex', 'type', 'width', 'x', 'y'],
      );
    });

    // Ids are unique per field (independently editable/selectable).
    expect(new Set(injected.map((f) => f.id)).size).toBe(injected.length);
  });

  it('routes edits to auto fields back through the same onFieldsChange list', async () => {
    analyzeDocument.mockResolvedValue({
      fields: ANALYZED,
      meta: { source: 'ai', analyzedAt: '2026-07-02T00:00:00.000Z', fieldCount: ANALYZED.length },
    });

    renderStep();
    await waitFor(() => expect(canvasProps?.fields).toHaveLength(ANALYZED.length));

    // Delete the first auto field and move the second — the canvas's own edit
    // callback, exercised exactly as a manual edit would be.
    const [first, second, third] = canvasProps!.fields;
    act(() => {
      canvasProps!.onFieldsChange([{ ...second!, x: 0.9, y: 0.1 }, third!]);
    });

    await waitFor(() => expect(canvasProps?.fields).toHaveLength(2));
    expect(canvasProps!.fields.map((f) => f.id)).toEqual([second!.id, third!.id]);
    expect(canvasProps!.fields[0]).toMatchObject({ x: 0.9, y: 0.1 });
    expect(canvasProps!.fields.some((f) => f.id === first!.id)).toBe(false);
  });

  it('injects nothing (and re-runs nothing) when analysis finds no fields', async () => {
    analyzeDocument.mockResolvedValue({
      fields: [],
      meta: {
        source: 'none',
        analyzedAt: '2026-07-02T00:00:00.000Z',
        fieldCount: 0,
        reason: 'AI가 배치할 필드를 찾지 못했어요. 필요한 위치에 직접 배치해 주세요.',
      },
    });

    renderStep();

    await waitFor(() => expect(analyzeDocument).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(canvasProps!.fields).toEqual([]);
  });
});
