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
 * Precise drag-placement is a desktop interaction (mouse + room to work); on a
 * touch / narrow viewport the step swaps to a touch-friendly "확인" review
 * surface (`MobileFieldsReview`) — same AI suggestions + confirm/adjust state,
 * tap-driven instead of drag-driven. Both share one analysis run and one set of
 * suggestion handlers below, so neither path re-derives anything.
 */

import * as React from 'react';
import { cn } from '@repo/ui';
import { SuggestionBanner } from '@/components/ai';
import {
  FIELD_TYPE_META,
  FIELD_TYPES,
  clampNormRect,
  type SignFieldType,
} from '@/lib/field-geometry';
import { analyzeForSuggestions } from '@/lib/signfield-analyze';
import {
  deriveBannerState,
  suggestionToFieldDraft,
  suggestionsToFieldDrafts,
} from '@/lib/signfield-suggestion';
import { useWizard, type SignFieldDraft } from './wizard-context';
import { FieldCanvas, FIELD_DND_TYPE, nextFieldId } from './field-canvas';
import { MobileFieldsReview } from './mobile-fields-review';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;
/** Page fits comfortably in the 760px wizard column at zoom 1. */
const BASE_FIT_WIDTH = 640;

export function FieldsStep() {
  const isDesktop = useIsDesktop();
  const { state, dispatch } = useWizard();
  const { file, document, fields, suggestions, analysis } = state;

  const [page, setPage] = React.useState(1);
  const [zoom, setZoom] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [pageCount, setPageCount] = React.useState(document?.pageCount ?? 0);

  const setFields = React.useCallback(
    (next: SignFieldDraft[]) => dispatch({ type: 'SET_FIELDS', fields: next }),
    [dispatch],
  );

  // --- AI auto-placement: run once per document on entering this step --------
  // Non-blocking — the canvas stays fully interactive while analysis is in
  // flight, and any outcome (suggestions / none / error) leaves manual placement
  // working. Results live in wizard state, so leaving and returning to the step
  // keeps them without re-running.
  const analyzedFileRef = React.useRef<File | null>(null);
  const latestFileRef = React.useRef(file);
  latestFileRef.current = file;

  const runAnalysis = React.useCallback(() => {
    if (!file) return;
    analyzedFileRef.current = file;
    dispatch({ type: 'ANALYSIS_START' });
    void analyzeForSuggestions(file).then((result) => {
      // A re-upload swaps the file (and resets state); drop a stale run's result.
      if (latestFileRef.current !== file) return;
      if (result.status === 'done') {
        dispatch({ type: 'ANALYSIS_DONE', suggestions: result.suggestions });
      } else if (result.status === 'empty') {
        dispatch({ type: 'ANALYSIS_EMPTY', message: result.message });
      } else {
        dispatch({ type: 'ANALYSIS_ERROR', message: result.message });
      }
    });
  }, [file, dispatch]);

  React.useEffect(() => {
    // Runs on every viewport: desktop drag-placement and the mobile "확인"
    // review both consume the same suggestions, so analysis is no longer gated.
    if (!file) return;
    if (analyzedFileRef.current === file) return; // already kicked off here
    // idle = fresh; analyzing = a prior mount's run was abandoned, so restart.
    if (analysis.status !== 'idle' && analysis.status !== 'analyzing') return;
    runAnalysis();
  }, [file, analysis.status, runAnalysis]);

  const acceptSuggestion = React.useCallback(
    (id: string): string | void => {
      const s = suggestions.find((x) => x.id === id);
      if (!s) return;
      const field = suggestionToFieldDraft(s, nextFieldId());
      dispatch({ type: 'ACCEPT_SUGGESTION', field, suggestionId: id });
      setSelectedId(field.id);
      // Return the new field id so the mobile review can re-select it for adjust.
      return field.id;
    },
    [suggestions, dispatch],
  );

  const dismissSuggestion = React.useCallback(
    (id: string) => dispatch({ type: 'DISMISS_SUGGESTION', suggestionId: id }),
    [dispatch],
  );

  const applyAllSuggestions = React.useCallback(() => {
    dispatch({
      type: 'ACCEPT_ALL_SUGGESTIONS',
      fields: suggestionsToFieldDrafts(suggestions, nextFieldId),
    });
  }, [suggestions, dispatch]);

  const clearSuggestions = React.useCallback(
    () => dispatch({ type: 'CLEAR_SUGGESTIONS' }),
    [dispatch],
  );

  const bannerState = deriveBannerState(analysis, suggestions.length);

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
      setFields([...fields, { id, type, page, ...norm }]);
      setSelectedId(id);
    },
    [fields, page, setFields],
  );

  if (!file) {
    // Defensive: the upload gate prevents reaching here without a document.
    return null;
  }

  if (!isDesktop) {
    // Touch / narrow viewport: review + confirm the AI suggestions instead of
    // precise drag-placement. Same suggestions, analysis state, and handlers.
    return (
      <MobileFieldsReview
        file={file}
        fields={fields}
        suggestions={suggestions}
        bannerState={bannerState}
        onAcceptSuggestion={acceptSuggestion}
        onDismissSuggestion={dismissSuggestion}
        onApplyAll={applyAllSuggestions}
        onClear={clearSuggestions}
        onRetry={runAnalysis}
        onFieldsChange={setFields}
      />
    );
  }

  const total = Math.max(pageCount, 1);
  const pageFieldCount = fields.filter((f) => f.page === page).length;

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-col gap-2xs">
        <h2 className="text-xl font-bold text-foreground">서명 필드를 배치해 주세요</h2>
        <p className="text-sm text-foreground-subtle">
          받는 분이 서명할 위치에 필드를 끌어다 놓으세요. 클릭하면 가운데에 추가돼요.
        </p>
      </div>

      {/* AI auto-placement summary — non-blocking; manual placement always works. */}
      {bannerState ? (
        <SuggestionBanner
          state={bannerState}
          onApplyAll={applyAllSuggestions}
          onClear={clearSuggestions}
          onRetry={runAnalysis}
        />
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
          suggestions={suggestions}
          onAcceptSuggestion={acceptSuggestion}
          onDismissSuggestion={dismissSuggestion}
          onPageCount={setPageCount}
          className="max-h-[60vh]"
        />

        {fields.length === 0 && suggestions.length === 0 ? (
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

/**
 * True on a desktop-class viewport: a precise pointer (mouse) and room to work.
 * Precise drag-placement is a mouse interaction, so coarse/narrow devices get
 * the touch "확인" review surface instead.
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
