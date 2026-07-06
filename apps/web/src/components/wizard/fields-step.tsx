'use client';

/**
 * Wizard step 2 — place sign fields on the contract (desktop only).
 *
 * A toolbar of three field tools (서명 / 날짜 / 텍스트) sits above an interactive
 * PDF page. Tools are dragged onto the page to drop a field where the cursor is,
 * or clicked/Enter-ed to drop one at page center (keyboard path). The page can be
 * paged through and zoomed; fields are stored as normalized, page-relative boxes
 * (`FieldCanvas` owns the canvas↔PDF conversion), so they hold position across
 * both. Everything writes straight to wizard state, so leaving and returning to
 * the step restores each field at its exact spot.
 *
 * Field placement is a desktop interaction (mouse + room to work); smaller /
 * touch viewports get a guidance fallback instead (mobile placement is out of
 * scope — the signer flow is the mobile-first surface).
 */

import * as React from 'react';
import { cn } from '@repo/ui';
import {
  FIELD_TYPE_META,
  FIELD_TYPES,
  clampNormRect,
  type SignFieldType,
} from '@/lib/field-geometry';
import { getToken } from '@/lib/auth';
import {
  fetchFieldAnalysis,
  requestPremiumAnalysis,
  resolvePremiumPrompt,
  nextAnalysisPollDelay,
  ANALYSIS_POLL,
  NEUTRAL_STATUS,
  type AnalysisStatus,
} from '@/lib/premium-trial';
import { AI_COPY } from '@/lib/ai-copy';
import { AiSuggestionBadge } from '@/components/ai/ai-suggestion-badge';
import { PremiumAiPrompt } from '@/components/ai/premium-ai-prompt';
import { useWizard, type SignFieldDraft } from './wizard-context';
import { FieldCanvas, FIELD_DND_TYPE, nextFieldId } from './field-canvas';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;
/** Page fits comfortably in the 760px wizard column at zoom 1. */
const BASE_FIT_WIDTH = 640;

export function FieldsStep() {
  const isDesktop = useIsDesktop();
  const { state, dispatch } = useWizard();
  const { file, document, fields } = state;

  const [page, setPage] = React.useState(1);
  const [zoom, setZoom] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [pageCount, setPageCount] = React.useState(document?.pageCount ?? 0);
  /** How many AI fields the analysis proposed for this document (null = not yet loaded). */
  const [aiSeededCount, setAiSeededCount] = React.useState<number | null>(null);
  /** Trial/upgrade status from the tiered analysis; drives the premium prompt. */
  const [analysisStatus, setAnalysisStatus] = React.useState<AnalysisStatus>(NEUTRAL_STATUS);
  /** The sender chose to place fields by hand, so the premium prompt is hidden. */
  const [promptDismissed, setPromptDismissed] = React.useState(false);
  /** The premium re-request is in flight (Story 2 consent). */
  const [promptBusy, setPromptBusy] = React.useState(false);
  /** The analysis is still running (initial fetch + bounded polling) — surfaces the
      calm "분석 중" notice while the background run resolves. */
  const [analyzing, setAnalyzing] = React.useState(false);
  /** The analysis reached a terminal failure (or polling timed out) — surfaces the
      calm "분석을 마치지 못했어요" fallback; the editor stays usable for manual placement. */
  const [analysisFailed, setAnalysisFailed] = React.useState(false);
  const seededDocIdRef = React.useRef<string | null>(null);

  const setFields = React.useCallback(
    (next: SignFieldDraft[]) => dispatch({ type: 'SET_FIELDS', fields: next }),
    [dispatch],
  );

  // On opening the editor for a document, pull its AI-proposed fields and drop
  // them onto the canvas as `source: 'ai'` suggestions, capturing the
  // trial/upgrade status so the premium prompt can branch.
  //
  // The analysis runs in the background on upload, so the first fetch can come
  // back still `analyzing` (the upload stamped the document as pending). We then
  // poll — bounded by `ANALYSIS_POLL.maxAttempts` with a backing-off delay — and
  // seed the fields the moment a terminal stage lands. Polling stops on
  // completion or failure; if it never settles within the bound we fall back to
  // the failure notice + manual placement. The seam degrades to an empty,
  // no-prompt result on any error, so this never blocks manual placement.
  const documentId = document?.id ?? null;
  React.useEffect(() => {
    if (!documentId) return;
    if (seededDocIdRef.current === documentId) return;
    seededDocIdRef.current = documentId;
    setPromptDismissed(false);
    setAnalyzing(true);
    setAnalysisFailed(false);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const token = getToken() ?? undefined;

    // A terminal analysis landed (or we gave up): seed any fields, record the
    // status, and stop the "분석 중" notice.
    const settle = (analysis: Awaited<ReturnType<typeof fetchFieldAnalysis>>) => {
      const { drafts, status } = analysis;
      if (drafts.length > 0) dispatch({ type: 'SEED_AI_SUGGESTIONS', fields: drafts });
      setAiSeededCount(drafts.length);
      setAnalysisStatus(status);
      setAnalyzing(false);
      setAnalysisFailed(status.failed);
    };

    const poll = () => {
      void fetchFieldAnalysis(documentId, token).then((analysis) => {
        if (cancelled) return;
        // Still pending: re-fetch after a bounded, backing-off delay.
        if (analysis.status.analyzing) {
          if (attempts < ANALYSIS_POLL.maxAttempts) {
            attempts += 1;
            timer = setTimeout(poll, nextAnalysisPollDelay(attempts));
            return;
          }
          // Bound reached and it never settled — degrade to manual placement
          // with the calm failure notice instead of spinning forever.
          setAnalysisStatus(NEUTRAL_STATUS);
          setAiSeededCount(0);
          setAnalyzing(false);
          setAnalysisFailed(true);
          return;
        }
        settle(analysis);
      });
    };
    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [documentId, dispatch]);

  const clearSuggestions = React.useCallback(() => {
    setSelectedId(null);
    dispatch({ type: 'CLEAR_AI_SUGGESTIONS' });
  }, [dispatch]);

  // Premium prompt actions. Accept: on either invite — the scanned-doc consent
  // invite (Story 2) or the text-PDF accuracy boost — re-request the analysis with
  // the premium engine and seed the fields it returns. Premium is unlimited, so
  // consent spends nothing. Dismiss: hide the prompt and keep the current
  // placement (or place by hand).
  const acceptPremium = React.useCallback(() => {
    if (!documentId) return;
    setPromptBusy(true);
    void requestPremiumAnalysis(documentId, getToken() ?? undefined).then(({ drafts, status }) => {
      if (drafts.length > 0) dispatch({ type: 'SEED_AI_SUGGESTIONS', fields: drafts });
      setAiSeededCount(drafts.length);
      setAnalysisStatus(status);
      setAnalysisFailed(status.failed);
      setPromptBusy(false);
    });
  }, [documentId, dispatch]);

  const placeManually = React.useCallback(() => {
    setSelectedId(null);
    setPromptDismissed(true);
  }, []);

  const addAtCenter = React.useCallback(
    (type: SignFieldType) => {
      const size = FIELD_TYPE_META[type].defaultSize;
      // Center in normalized space — no page pixels needed; y is symmetric.
      const norm = clampNormRect({
        x: 0.5 - size.width / 2,
        y: 0.5 - size.height / 2,
        width: size.width,
        height: size.height,
      });
      const id = nextFieldId();
      setFields([...fields, { id, type, page, source: 'manual', ...norm }]);
      setSelectedId(id);
    },
    [fields, page, setFields],
  );

  if (!file) {
    // Defensive: the upload gate prevents reaching here without a document.
    return null;
  }

  if (!isDesktop) {
    return <DesktopOnlyFallback />;
  }

  const total = Math.max(pageCount, 1);
  const pageFieldCount = fields.filter((f) => f.page === page).length;
  const aiFieldCount = fields.filter((f) => f.source === 'ai').length;
  // Which premium surface (if any) to show: the scanned-doc consent invite or the
  // optional text-PDF accuracy boost. Hidden once the sender dismisses it (keeping
  // the base placement / placing by hand), or once the premium engine has already
  // run. Premium is unlimited, so there is no trial count and no upgrade surface.
  const premiumPrompt = promptDismissed ? null : resolvePremiumPrompt(analysisStatus);

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-col gap-2xs">
        <h2 className="text-xl font-bold text-foreground">서명 필드를 배치해 주세요</h2>
        <p className="text-sm text-foreground-subtle">
          받는 분이 서명할 위치에 필드를 끌어다 놓으세요. 클릭하면 가운데에 추가돼요.
        </p>
      </div>

      {/* Premium AI flow. A scanned document offers the premium engine as a consent
          invite (invite); a text PDF the base engine already handled offers it as an
          *optional* accuracy boost (boost) — the base placement stays unlimited.
          Premium is unlimited on every plan, so there is no trial count and no
          upgrade wall. Both are a non-intrusive inline banner with an equal
          "keep it / place by hand" escape, so they never block the editor. It
          supersedes the standard suggestion notice while shown. */}
      {premiumPrompt ? (
        <PremiumAiPrompt
          mode={premiumPrompt}
          busy={promptBusy}
          onAccept={acceptPremium}
          onDismiss={placeManually}
        />
      ) : analyzing ? (
        /* AI analysis is running (Story 1/2). A calm, non-blocking notice — the
           editor is already usable for manual placement while it resolves, and the
           status is announced to assistive tech. Which engine runs (scan vs text)
           stays hidden per the AI copy tone. */
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-sm rounded-md border border-ai/30 bg-ai-subtle px-sm py-xs"
        >
          <AiSuggestionBadge />
          <p className="text-sm font-medium text-ai-strong">{AI_COPY.analysis.analyzing}</p>
        </div>
      ) : analysisFailed ? (
        /* Analysis could not complete (service hiccup / timeout, or polling gave
           up). A calm, non-blaming line that hands control back — the editor is
           fully usable for manual placement. Distinct from "found nothing". */
        <p role="status" aria-live="polite" className="text-sm text-foreground-subtle">
          {AI_COPY.analysis.failed}
        </p>
      ) : aiFieldCount > 0 ? (
        /* AI-suggestion notice. While suggestions are on the canvas, a calm banner
           states what the AI proposed and offers a one-tap "clear all". */
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-sm rounded-md border border-ai/30 bg-ai-subtle px-sm py-xs"
        >
          <AiSuggestionBadge />
          <p className="text-sm font-medium text-ai-strong">
            {AI_COPY.suggestion.placed(aiFieldCount)}
          </p>
          <button
            type="button"
            onClick={clearSuggestions}
            className={cn(
              'ml-auto rounded-sm text-xs font-semibold text-ai-strong underline-offset-2',
              'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            )}
          >
            {AI_COPY.suggestion.clearAll}
          </button>
        </div>
      ) : aiSeededCount === 0 ? (
        /* Analysis found nothing to place — a subtle line hands control back to
           the sender. Also the state after declining the premium prompt. */
        <p role="status" aria-live="polite" className="text-sm text-foreground-subtle">
          {AI_COPY.suggestion.none}
        </p>
      ) : null}

      {/* Tool palette */}
      <div className="flex flex-wrap items-center gap-xs">
        {FIELD_TYPES.map((type) => (
          <FieldTool key={type} type={type} onAdd={() => addAtCenter(type)} />
        ))}
        <span className="ml-auto text-xs font-medium text-foreground-subtle">
          이 페이지에 {pageFieldCount}개 · 전체 {fields.length}개
        </span>
      </div>

      {/* Page nav + zoom */}
      <div className="flex items-center justify-between gap-sm rounded-md border border-border bg-surface px-sm py-2xs">
        <div className="flex items-center gap-2xs">
          <IconButton
            label="이전 페이지"
            disabled={page <= 1}
            onClick={() => {
              setSelectedId(null);
              setPage((p) => Math.max(1, p - 1));
            }}
          >
            <ChevronIcon dir="left" />
          </IconButton>
          <span className="min-w-[72px] text-center text-sm font-medium text-foreground tabular-nums">
            {page} / {total} 페이지
          </span>
          <IconButton
            label="다음 페이지"
            disabled={page >= total}
            onClick={() => {
              setSelectedId(null);
              setPage((p) => Math.min(total, p + 1));
            }}
          >
            <ChevronIcon dir="right" />
          </IconButton>
        </div>

        <div className="flex items-center gap-2xs">
          <IconButton
            label="축소"
            disabled={zoom <= ZOOM_MIN}
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
          >
            <MinusIcon />
          </IconButton>
          <span className="min-w-[48px] text-center text-sm font-medium text-foreground tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton
            label="확대"
            disabled={zoom >= ZOOM_MAX}
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
          >
            <PlusIcon />
          </IconButton>
        </div>
      </div>

      {/* Placement surface */}
      <div className="relative max-h-[68vh] overflow-hidden rounded-lg border border-border bg-surface-muted p-md">
        <FieldCanvas
          file={file}
          page={page}
          zoom={zoom}
          fitWidth={BASE_FIT_WIDTH}
          fields={fields}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onFieldsChange={setFields}
          onPageCount={setPageCount}
          className="max-h-[60vh]"
        />

        {fields.length === 0 ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-md text-center text-xs font-medium text-foreground-subtle">
            위 도구를 PDF 위로 끌어다 놓아 필드를 배치하세요
          </p>
        ) : null}
      </div>

      <p className="text-xs text-foreground-subtle">
        필드를 선택한 뒤 방향키로 이동, Shift+방향키로 크기 조절, Delete로 삭제할 수 있어요.
      </p>
    </div>
  );
}

/** A draggable + clickable palette tool. */
function FieldTool({ type, onAdd }: { type: SignFieldType; onAdd: () => void }) {
  const meta = FIELD_TYPE_META[type];
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(FIELD_DND_TYPE, type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onAdd}
      aria-label={`${meta.label} 필드 추가 (끌어다 놓거나 클릭)`}
      className={cn(
        'inline-flex cursor-grab items-center gap-xs rounded-md border border-border bg-surface px-sm py-2xs',
        'text-sm font-semibold text-foreground shadow-xs',
        'transition-[transform,border-color,background-color] duration-fast ease-standard',
        'hover:border-primary hover:bg-primary-subtle/50 hover:text-primary',
        'focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.97] active:cursor-grabbing',
      )}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary-subtle text-primary">
        <ToolGlyph type={type} />
      </span>
      {meta.label}
    </button>
  );
}

function DesktopOnlyFallback() {
  return (
    <div className="flex flex-col items-center justify-center gap-sm rounded-lg border border-dashed border-border-strong bg-surface-muted px-md py-3xl text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-subtle text-primary">
        <DesktopIcon />
      </span>
      <div className="flex flex-col gap-2xs">
        <h2 className="text-lg font-bold text-foreground">데스크톱에서 필드를 배치해 주세요</h2>
        <p className="max-w-[420px] text-sm text-foreground-subtle">
          서명 필드 배치는 마우스가 있는 큰 화면에 맞춰져 있어요. 데스크톱에서 이어서 진행해 주세요.
        </p>
      </div>
    </div>
  );
}

/**
 * True on a desktop-class viewport: a precise pointer (mouse) and room to work.
 * Field placement is a mouse interaction, so coarse/narrow devices fall back.
 */
const DESKTOP_QUERY = '(min-width: 1024px) and (pointer: fine)';

function useIsDesktop(): boolean {
  // Lazy init avoids a fallback flash on desktop (and is SSR-safe — the wizard
  // route is client-gated, so there is no server render to mismatch).
  const [isDesktop, setIsDesktop] = React.useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : false,
  );
  React.useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isDesktop;
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-sm text-foreground-muted',
        'transition-colors duration-fast hover:bg-grey-100 hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}

function ToolGlyph({ type }: { type: SignFieldType }) {
  if (type === 'SIGNATURE') {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
        <path d="M2 12c2-1 3-7 5-7s1 5 3 5 2-3 4-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'DATE') {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M4 4h8M8 4v8M6.5 12h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M12 5l-5 5 5 5' : 'M8 5l5 5-5 5'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M10 5v10M5 10h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M5 10h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DesktopIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 20h6M12 16v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
