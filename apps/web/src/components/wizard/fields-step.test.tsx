/**
 * @jest-environment jsdom
 */

/**
 * FieldsStep auto-place → 추천 → 수락 → 확정 integration (grain-5).
 *
 * Drives the completion criterion through the real step UI: click 자동으로 배치,
 * watch recommendations appear (inline summary + badges + batch bar), and confirm
 * that until the user accepts, nothing counts toward the saved set. Then 모두 수락
 * promotes every recommendation to confirmed — the exact set the existing save
 * flow persists.
 *
 * The no-anchor safety net is exercised too: when auto-place finds nothing, the
 * screen shows neutral guidance (not an error), renders no recommendations, and
 * manual placement keeps working — proving the screen never breaks.
 *
 * Heavy collaborators are mocked to keep the test on the step's own logic:
 * `@/lib/auto-place` (the pdfjs pipeline), `@/lib/pdf` (the canvas raster),
 * `@repo/ui` (Button/cn), and the template dialog. Desktop is forced via
 * matchMedia so the placement surface (not the mobile fallback) renders.
 */

import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@repo/ui', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
  // Minimal Button: forward click/disabled/children, drop styling-only props so
  // React doesn't warn about unknown DOM attributes.
  Button: ({
    children,
    onClick,
    disabled,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    isLoading,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    variant,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    size,
    ...rest
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    variant?: string;
    size?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

jest.mock('@/lib/pdf', () => ({
  openPdf: jest.fn(async () => ({ doc: { destroy: jest.fn() }, pageCount: 1 })),
  renderPageToCanvas: jest.fn(async () => ({ cssWidth: 640, cssHeight: 905 })),
  isRenderCancelled: () => false,
  PdfRenderError: class PdfRenderError extends Error {},
}));

jest.mock('@/lib/auto-place', () => ({
  autoPlaceFields: jest.fn(),
}));

jest.mock('./save-template-dialog', () => ({
  SaveTemplateDialog: () => null,
}));

import { FieldsStep } from './fields-step';
import { autoPlaceFields } from '@/lib/auto-place';
import {
  WizardProvider,
  useWizard,
  confirmedFields,
  isRecommended,
  type WizardPreload,
} from './wizard-context';
import type { FieldCandidate } from '@/lib/field-anchors';
import type { DocumentSummary } from '@/lib/documents';

const mockAutoPlace = autoPlaceFields as jest.MockedFunction<typeof autoPlaceFields>;

const candidate = (type: FieldCandidate['type'], y: number): FieldCandidate => ({
  type,
  page: 1,
  rect: { x: 0.2, y, width: 0.26, height: 0.06 },
  anchorText: type,
  category: 'SIGN',
});

const preload: WizardPreload = {
  document: { id: 'doc_1', storageKey: 'key_1', pageCount: 1 } as unknown as DocumentSummary,
  file: new File(['%PDF-1.4'], 'contract.pdf', { type: 'application/pdf' }),
  fields: [],
};

/** Surfaces the live confirmed/recommended counts for assertions. */
function Probe() {
  const { state } = useWizard();
  return (
    <div
      data-testid="probe"
      data-confirmed={confirmedFields(state.fields).length}
      data-recommended={state.fields.filter(isRecommended).length}
    />
  );
}

function renderStep() {
  return render(
    <WizardProvider preload={preload}>
      <FieldsStep />
      <Probe />
    </WizardProvider>,
  );
}

const probe = () => screen.getByTestId('probe');

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true, // desktop-class viewport → real placement surface
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => jest.clearAllMocks());

async function waitForCanvas() {
  await waitFor(() => expect(screen.getByLabelText('계약 PDF 1페이지')).toBeInTheDocument());
}

describe('FieldsStep — 자동 배치 → 추천 → 수락 → 확정', () => {
  it('surfaces recommendations that stay out of the saved set until 모두 수락 confirms them', async () => {
    mockAutoPlace.mockResolvedValue([candidate('SIGNATURE', 0.6), candidate('DATE', 0.4)]);
    renderStep();
    await waitForCanvas();

    // Before running: nothing recommended, nothing confirmed, no badges.
    expect(probe()).toHaveAttribute('data-recommended', '0');
    expect(probe()).toHaveAttribute('data-confirmed', '0');
    expect(screen.queryByText('추천')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '자동으로 배치' }));

    // Inline summary (never a toast) confirms the run placed recommendations.
    await screen.findByText('추천 필드 2개를 넣었어요. 확인하고 수락해 주세요.');
    // Batch bar + two recommendation badges are on screen.
    expect(screen.getByText('추천 필드 2개')).toBeInTheDocument();
    expect(screen.getAllByText('추천')).toHaveLength(2);

    // They are injected as recommendations — excluded from the saved set/gate.
    expect(probe()).toHaveAttribute('data-recommended', '2');
    expect(probe()).toHaveAttribute('data-confirmed', '0');

    // 모두 수락 promotes every recommendation to a confirmed (saved) field.
    fireEvent.click(screen.getByRole('button', { name: '모두 수락' }));

    await waitFor(() => expect(probe()).toHaveAttribute('data-confirmed', '2'));
    expect(probe()).toHaveAttribute('data-recommended', '0');
    // Badges + batch bar clear once nothing is recommended.
    expect(screen.queryByText('추천')).not.toBeInTheDocument();
    expect(screen.queryByText('추천 필드 2개')).not.toBeInTheDocument();
  });

  it('accepts a single recommendation from the canvas, leaving the rest recommended', async () => {
    mockAutoPlace.mockResolvedValue([candidate('SIGNATURE', 0.6), candidate('DATE', 0.4)]);
    renderStep();
    await waitForCanvas();

    fireEvent.click(screen.getByRole('button', { name: '자동으로 배치' }));
    await screen.findByText('추천 필드 2개를 넣었어요. 확인하고 수락해 주세요.');

    // Activate the 서명 recommendation and accept it via its per-field control.
    const sign = screen.getByRole('button', { name: /서명 추천 필드\./ });
    fireEvent.focus(sign);
    fireEvent.click(await screen.findByRole('button', { name: '서명 추천 필드 수락' }));

    await waitFor(() => expect(probe()).toHaveAttribute('data-confirmed', '1'));
    // One left recommended — the batch bar now reads a single field.
    expect(probe()).toHaveAttribute('data-recommended', '1');
    expect(screen.getByText('추천 필드 1개')).toBeInTheDocument();
  });
});

describe('FieldsStep — no-anchor safety net', () => {
  it('shows neutral guidance (not an error), no recommendations, and manual placement still works', async () => {
    mockAutoPlace.mockResolvedValue([]);
    renderStep();
    await waitForCanvas();

    fireEvent.click(screen.getByRole('button', { name: '자동으로 배치' }));

    // Neutral, non-danger guidance that routes the user to manual placement.
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('자동으로 넣을 서명 위치를 찾지 못했어요. 아래 도구로 직접 배치해 주세요.');
    // No recommendations rendered, and the placement surface is intact.
    expect(screen.queryByText('추천')).not.toBeInTheDocument();
    expect(probe()).toHaveAttribute('data-recommended', '0');
    expect(screen.getByLabelText('계약 PDF 1페이지')).toBeInTheDocument();

    // Manual placement carries on: click the 서명 tool to drop a field at center.
    fireEvent.click(screen.getByRole('button', { name: '서명 필드 추가 (끌어다 놓거나 클릭)' }));
    await waitFor(() => expect(probe()).toHaveAttribute('data-confirmed', '1'));
    // A manually placed field is confirmed immediately — never a recommendation.
    expect(probe()).toHaveAttribute('data-recommended', '0');
  });
});
