/**
 * @jest-environment jsdom
 */

/**
 * Render-path contract: an auto-placed (AI) field and a hand-placed field flow
 * through the *same* interactive `FieldBox` — there is no `origin`-driven
 * read-only / disabled branch anywhere in the canvas.
 *
 * `SignFieldDraft` carries no provenance marker (locked by the state-layer suite
 * in `wizard-context.test.ts`), so a field the analysis draft produced (minted
 * via `nextFieldId`, exactly as `fields-step` maps `analyzeDocument` results) is
 * structurally identical to one placed by hand. These tests assert that identity
 * end-to-end at the render layer: both fields expose the delete button on select,
 * eight resize handles on select/hover, and keyboard delete / arrow-move /
 * Shift+arrow-resize — with byte-identical box markup and no visual provenance
 * cue. `@/lib/pdf` is mocked so the canvas mounts in jsdom without rasterizing.
 */

import * as React from 'react';
import { render, screen, fireEvent, createEvent, waitFor, within } from '@testing-library/react';
import { FieldCanvas, nextFieldId } from './field-canvas';
import type { SignFieldDraft } from './wizard-context';

// cn only joins class strings here — the component passes strings/conditionals.
jest.mock('@repo/ui', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// No real rasterization: the document "opens" and each page "renders" instantly,
// so the overlay + fields mount in jsdom without touching a 2D context.
jest.mock('@/lib/pdf', () => {
  class PdfRenderError extends Error {}
  return {
    __esModule: true,
    openPdf: jest.fn(async () => ({ doc: { destroy: jest.fn() }, pageCount: 1 })),
    renderPageToCanvas: jest.fn(async () => ({ cssWidth: 640, cssHeight: 905 })),
    isRenderCancelled: () => false,
    PdfRenderError,
  };
});

import * as pdf from '@/lib/pdf';

const renderPageToCanvasMock = pdf.renderPageToCanvas as jest.Mock;

const fakeSource = { kind: 'file' as const, file: {} as unknown as File };

/**
 * A field shaped exactly as `fields-step` produces from an `analyzeDocument`
 * result: server geometry verbatim + a freshly minted client id, no marker.
 */
function autoField(over: Partial<SignFieldDraft> = {}): SignFieldDraft {
  return {
    id: nextFieldId(),
    type: 'SIGNATURE',
    page: 1,
    x: 0.12,
    y: 0.62,
    width: 0.26,
    height: 0.08,
    recipientIndex: 0,
    ...over,
  };
}

/** A field shaped exactly as `addAtCenter` / drop-placement produces by hand. */
function manualField(over: Partial<SignFieldDraft> = {}): SignFieldDraft {
  return {
    id: nextFieldId(),
    type: 'TEXT',
    page: 1,
    x: 0.5,
    y: 0.3,
    width: 0.28,
    height: 0.06,
    ...over,
  };
}

const LABEL: Record<SignFieldDraft['type'], string> = {
  SIGNATURE: '서명',
  DATE: '날짜',
  TEXT: '텍스트',
};

/** The interactive FieldBox for a field type (matched by its aria-label). */
function fieldBox(type: SignFieldDraft['type']): HTMLElement {
  return screen.getByRole('button', {
    name: new RegExp(`^${LABEL[type]} 필드\\. 방향키로`),
  });
}

/** Controlled harness mirroring `fields-step`'s single-source wiring. */
function Harness({
  initialFields,
  initialSelected = null,
  onChange,
}: {
  initialFields: SignFieldDraft[];
  initialSelected?: string | null;
  onChange?: (next: SignFieldDraft[]) => void;
}) {
  const [fields, setFields] = React.useState(initialFields);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialSelected);
  return (
    <FieldCanvas
      source={fakeSource}
      page={1}
      zoom={1}
      fitWidth={640}
      fields={fields}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onFieldsChange={(next) => {
        onChange?.(next);
        setFields(next);
      }}
    />
  );
}

/** Mount and let the mocked open/render effects settle (avoids act warnings). */
async function mount(ui: React.ReactElement) {
  const utils = render(ui);
  await waitFor(() => expect(renderPageToCanvasMock).toHaveBeenCalled());
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('auto and manual fields render through the identical interactive path', () => {
  it('renders both origins as the same interactive FieldBox — no read-only / disabled branch', async () => {
    const auto = autoField();
    const manual = manualField();
    await mount(<Harness initialFields={[auto, manual]} />);

    const autoBox = fieldBox('SIGNATURE');
    const manualBox = fieldBox('TEXT');

    for (const box of [autoBox, manualBox]) {
      // Every field is a focusable, pressable button — never inert.
      expect(box.tagName).toBe('DIV');
      expect(box.getAttribute('role')).toBe('button');
      expect(box.getAttribute('tabindex')).toBe('0');
      expect(box.hasAttribute('disabled')).toBe(false);
      expect(box.getAttribute('aria-disabled')).toBeNull();
      expect(box.getAttribute('aria-readonly')).toBeNull();
      expect(box.getAttribute('contenteditable')).toBeNull();
    }

    // Same key affordance-bearing markup regardless of origin: the box className
    // depends only on interaction state, never on which field it is. Identical
    // class strings => there is no per-field visual provenance cue.
    expect(autoBox.className).toBe(manualBox.className);

    // And nothing in the whole overlay is rendered read-only / disabled.
    const overlay = autoBox.parentElement!;
    expect(overlay.querySelectorAll('[disabled]')).toHaveLength(0);
    expect(overlay.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0);
    expect(overlay.querySelectorAll('[readonly],[aria-readonly="true"]')).toHaveLength(0);
  });

  it('exposes no `origin`/`source`/provenance data-attribute on either field', async () => {
    await mount(<Harness initialFields={[autoField(), manualField()]} />);
    for (const box of [fieldBox('SIGNATURE'), fieldBox('TEXT')]) {
      for (const attr of Array.from(box.attributes)) {
        expect(attr.name).not.toMatch(/origin|source|provenance|auto|analyzed/i);
      }
    }
  });
});

// Every affordance is asserted for BOTH an auto-origin field and a manual field,
// proving the shared path never forks on provenance.
describe.each([
  ['auto (AI-placed)', autoField, 'SIGNATURE' as const],
  ['manual (hand-placed)', manualField, 'TEXT' as const],
])('shared affordances — %s field', (_label, make, type) => {
  it('reveals the delete button when selected', async () => {
    const field = make();
    await mount(<Harness initialFields={[field]} initialSelected={field.id} />);

    expect(
      screen.getByRole('button', { name: `${LABEL[type]} 필드 삭제` }),
    ).toBeTruthy();
  });

  it('shows all 8 resize handles when selected', async () => {
    const field = make();
    await mount(<Harness initialFields={[field]} initialSelected={field.id} />);

    // Handles are the only <span class="rounded-full"> inside the box.
    expect(fieldBox(type).querySelectorAll('span.rounded-full')).toHaveLength(8);
  });

  it('shows all 8 resize handles on hover (unselected)', async () => {
    const field = make();
    await mount(<Harness initialFields={[field]} />);

    const box = fieldBox(type);
    expect(box.querySelectorAll('span.rounded-full')).toHaveLength(0);
    fireEvent.pointerEnter(box);
    expect(box.querySelectorAll('span.rounded-full')).toHaveLength(8);
  });

  it('selects the field on pointer-down (shared select path)', async () => {
    const field = make();
    await mount(<Harness initialFields={[field]} />);

    const box = fieldBox(type);
    expect(box.getAttribute('aria-pressed')).toBe('false');
    // jsdom's PointerEvent shim drops `button`; force the primary-button value
    // the move-gesture guard requires so the shared select path actually runs.
    const down = createEvent.pointerDown(box);
    Object.defineProperty(down, 'button', { value: 0 });
    fireEvent(box, down);
    expect(box.getAttribute('aria-pressed')).toBe('true');
    // Selecting reveals the delete affordance — same as any manual field.
    expect(screen.getByRole('button', { name: `${LABEL[type]} 필드 삭제` })).toBeTruthy();
  });

  it('deletes via the Delete key', async () => {
    const field = make();
    const onChange = jest.fn();
    await mount(<Harness initialFields={[field]} initialSelected={field.id} onChange={onChange} />);

    fireEvent.keyDown(fieldBox(type), { key: 'Delete' });
    expect(onChange).toHaveBeenCalledWith([]);
    // Gone from the DOM too.
    expect(screen.queryByRole('button', { name: new RegExp(`^${LABEL[type]} 필드\\. `) })).toBeNull();
  });

  it('deletes via the Backspace key', async () => {
    const field = make();
    const onChange = jest.fn();
    await mount(<Harness initialFields={[field]} initialSelected={field.id} onChange={onChange} />);

    fireEvent.keyDown(fieldBox(type), { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('deletes via the corner delete button', async () => {
    const field = make();
    const onChange = jest.fn();
    await mount(<Harness initialFields={[field]} initialSelected={field.id} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: `${LABEL[type]} 필드 삭제` }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('moves with the arrow keys', async () => {
    const field = make();
    const onChange = jest.fn();
    await mount(<Harness initialFields={[field]} initialSelected={field.id} onChange={onChange} />);

    fireEvent.keyDown(fieldBox(type), { key: 'ArrowRight' });
    const next = onChange.mock.calls.at(-1)![0] as SignFieldDraft[];
    const moved = next.find((f) => f.id === field.id)!;
    expect(moved.x).toBeGreaterThan(field.x); // nudged right
    expect(moved.width).toBeCloseTo(field.width, 5); // size preserved
  });

  it('resizes with Shift+arrow keys', async () => {
    const field = make();
    const onChange = jest.fn();
    await mount(<Harness initialFields={[field]} initialSelected={field.id} onChange={onChange} />);

    fireEvent.keyDown(fieldBox(type), { key: 'ArrowDown', shiftKey: true });
    const next = onChange.mock.calls.at(-1)![0] as SignFieldDraft[];
    const resized = next.find((f) => f.id === field.id)!;
    expect(resized.height).toBeGreaterThan(field.height); // grew downward
  });
});

describe('editing one field never disturbs the other, regardless of origin', () => {
  it('deleting the auto field leaves the manual field intact (and vice versa)', async () => {
    const auto = autoField();
    const manual = manualField();
    const onChange = jest.fn();
    await mount(
      <Harness initialFields={[auto, manual]} initialSelected={auto.id} onChange={onChange} />,
    );

    fireEvent.keyDown(fieldBox('SIGNATURE'), { key: 'Delete' });
    expect(onChange).toHaveBeenLastCalledWith([manual]);

    // The manual field is still the same editable box.
    const manualBox = within(document.body).getByRole('button', {
      name: /^텍스트 필드\. 방향키로/,
    });
    expect(manualBox.getAttribute('tabindex')).toBe('0');
  });
});
