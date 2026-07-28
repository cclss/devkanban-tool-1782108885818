/**
 * @jest-environment jsdom
 */

/**
 * FieldCanvas recommended-field rendering + accept/삭제 wiring (grain-5).
 *
 * The canvas is where an auto-place suggestion visibly reads as a *recommendation*
 * and where the per-field 수락/삭제 affordances live. These tests render the real
 * component over a mocked pdfjs loader (no worker, no raster) and pin:
 *   • a recommended field renders the "추천" badge + recommendation aria-label,
 *     while a confirmed field renders the plain field label (no badge);
 *   • activating a recommendation exposes its 수락 button, and clicking it calls
 *     `onAcceptField` with that field's id;
 *   • the 삭제 button removes the field from the set;
 *   • a confirmed field offers 삭제 but never 수락;
 *   • an all-confirmed page (the no-recommendation case) renders cleanly.
 *
 * `@/lib/pdf` is fully mocked so `openPdf`/`renderPageToCanvas` resolve instantly
 * with no canvas 2D context; `@repo/ui`'s `cn` is stubbed to a plain class join.
 */

import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@repo/ui', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

jest.mock('@/lib/pdf', () => ({
  openPdf: jest.fn(async () => ({ doc: { destroy: jest.fn() }, pageCount: 1 })),
  renderPageToCanvas: jest.fn(async () => ({ cssWidth: 640, cssHeight: 905 })),
  isRenderCancelled: () => false,
  PdfRenderError: class PdfRenderError extends Error {},
}));

import { FieldCanvas } from './field-canvas';
import type { SignFieldDraft } from './wizard-context';

const file = new File(['%PDF-1.4'], 'contract.pdf', { type: 'application/pdf' });

const recommended: SignFieldDraft = {
  id: 'r1', type: 'SIGNATURE', page: 1, x: 0.2, y: 0.6, width: 0.26, height: 0.08, status: 'recommended',
};
const confirmed: SignFieldDraft = {
  id: 'c1', type: 'TEXT', page: 1, x: 0.2, y: 0.2, width: 0.28, height: 0.06,
};

/**
 * Renders FieldCanvas with local selection + field state so the accept/delete
 * paths (which flow through the parent) are observable. `onAcceptField` is a spy
 * the test asserts against.
 */
function Harness({
  initialFields,
  onAcceptField,
  withAccept = true,
}: {
  initialFields: SignFieldDraft[];
  onAcceptField?: jest.Mock;
  withAccept?: boolean;
}) {
  const [fields, setFields] = React.useState(initialFields);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  return (
    <FieldCanvas
      file={file}
      page={1}
      zoom={1}
      fitWidth={640}
      fields={fields}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onFieldsChange={setFields}
      onAcceptField={withAccept ? onAcceptField : undefined}
    />
  );
}

/** Wait until the page canvas has rendered (openPdf + render effects settled). */
async function waitForCanvas() {
  await waitFor(() => expect(screen.getByLabelText('계약 PDF 1페이지')).toBeInTheDocument());
}

describe('FieldCanvas — recommended vs confirmed rendering', () => {
  it('renders a recommendation with the "추천" badge and recommendation aria-label', async () => {
    render(<Harness initialFields={[recommended, confirmed]} onAcceptField={jest.fn()} />);
    await waitForCanvas();

    // Recommendation: always-on "추천" text badge (color-independent axis).
    expect(screen.getByText('추천')).toBeInTheDocument();
    // Its box carries the recommendation-specific label.
    expect(
      screen.getByRole('button', { name: /서명 추천 필드\./ }),
    ).toBeInTheDocument();
    // The confirmed field renders the plain label — no badge, no "추천 필드".
    expect(
      screen.getByRole('button', { name: '텍스트 필드. 방향키로 이동, Shift+방향키로 크기 조절, Delete로 삭제' }),
    ).toBeInTheDocument();
  });

  it('exposes 수락 on an activated recommendation and calls onAcceptField with its id', async () => {
    const onAcceptField = jest.fn();
    render(<Harness initialFields={[recommended]} onAcceptField={onAcceptField} />);
    await waitForCanvas();

    const box = screen.getByRole('button', { name: /서명 추천 필드\./ });
    // The accept affordance is hidden until the field is active — no clutter.
    expect(screen.queryByRole('button', { name: '서명 추천 필드 수락' })).not.toBeInTheDocument();

    // Focusing the field activates it (keyboard-reachable), revealing 수락/삭제.
    fireEvent.focus(box);
    const accept = await screen.findByRole('button', { name: '서명 추천 필드 수락' });
    fireEvent.click(accept);

    expect(onAcceptField).toHaveBeenCalledTimes(1);
    expect(onAcceptField).toHaveBeenCalledWith('r1');
  });

  it('삭제 removes the field from the set', async () => {
    render(<Harness initialFields={[recommended]} onAcceptField={jest.fn()} />);
    await waitForCanvas();

    const box = screen.getByRole('button', { name: /서명 추천 필드\./ });
    fireEvent.focus(box);
    const del = await screen.findByRole('button', { name: '서명 추천 필드 삭제' });
    fireEvent.click(del);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /서명 추천 필드\./ })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('추천')).not.toBeInTheDocument();
  });

  it('a confirmed field offers 삭제 but never 수락', async () => {
    render(<Harness initialFields={[confirmed]} onAcceptField={jest.fn()} />);
    await waitForCanvas();

    const box = screen.getByRole('button', {
      name: '텍스트 필드. 방향키로 이동, Shift+방향키로 크기 조절, Delete로 삭제',
    });
    fireEvent.focus(box);

    expect(await screen.findByRole('button', { name: '텍스트 필드 삭제' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /수락/ })).not.toBeInTheDocument();
  });

  it('renders a page of only confirmed fields cleanly (no recommendations present)', async () => {
    render(<Harness initialFields={[confirmed]} withAccept={false} />);
    await waitForCanvas();

    expect(screen.queryByText('추천')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '텍스트 필드. 방향키로 이동, Shift+방향키로 크기 조절, Delete로 삭제' }),
    ).toBeInTheDocument();
  });
});
