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
import { useWizard, type SignFieldDraft } from './wizard-context';
import { FieldCanvas, FIELD_DND_TYPE, nextFieldId } from './field-canvas';
import { autoPlaceFields, candidatesToSuggestions } from '@/lib/field-candidates';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;
/** Page fits comfortably in the 760px wizard column at zoom 1. */
const BASE_FIT_WIDTH = 640;

/**
 * Auto-placement run state, kept local to this step (recommendations are
 * transient — they vanish on re-entry, which is allowed).
 *   idle    — never run / cleared
 *   loading — reading the PDF and matching anchors
 *   ready   — one or more recommendations are on the page
 *   empty   — ran successfully but found nothing to recommend
 *   error   — the run failed; the manual flow is unaffected
 */
type AutoPlaceStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export function FieldsStep() {
  const isDesktop = useIsDesktop();
  const { state, dispatch } = useWizard();
  const { file, document, fields } = state;

  const [page, setPage] = React.useState(1);
  const [zoom, setZoom] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [pageCount, setPageCount] = React.useState(document?.pageCount ?? 0);

  // Auto-placement recommendations live only in this step's local state — they
  // are drafts awaiting the user's accept/edit/dismiss, never persisted until
  // promoted into `fields`. Leaving and returning drops them (allowed).
  const [suggestions, setSuggestions] = React.useState<SignFieldDraft[]>([]);
  const [autoStatus, setAutoStatus] = React.useState<AutoPlaceStatus>('idle');

  const setFields = React.useCallback(
    (next: SignFieldDraft[]) => dispatch({ type: 'SET_FIELDS', fields: next }),
    [dispatch],
  );

  // Run auto-placement: read the PDF, match anchors, and drop the survivors
  // (deduped against already-placed fields) into local recommendation state.
  // Any failure falls back to the manual flow with an error notice.
  const runAutoPlace = React.useCallback(async () => {
    if (!file) return;
    setAutoStatus('loading');
    try {
      const candidates = await autoPlaceFields(file);
      const drafts = candidatesToSuggestions(candidates, fields);
      if (drafts.length === 0) {
        setSuggestions([]);
        setAutoStatus('empty');
        return;
      }
      setSuggestions(drafts.map((draft) => ({ ...draft, id: nextFieldId() })));
      setAutoStatus('ready');
    } catch {
      setSuggestions([]);
      setAutoStatus('error');
    }
  }, [file, fields]);

  // Promote a recommendation into the confirmed field list with a fresh id, then
  // drop it from the recommendation layer. Shared by accept and "편집=수락".
  const promoteSuggestion = React.useCallback(
    (id: string, patch?: Partial<SignFieldDraft>) => {
      const match = suggestions.find((s) => s.id === id);
      if (!match) return;
      const { id: _drop, ...rest } = match;
      const newId = nextFieldId();
      setFields([...fields, { ...rest, ...patch, id: newId }]);
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
      setSelectedId(newId);
    },
    [suggestions, fields, setFields],
  );

  const acceptSuggestion = React.useCallback((id: string) => promoteSuggestion(id), [promoteSuggestion]);
  const changeSuggestion = React.useCallback(
    (id: string, patch: Partial<SignFieldDraft>) => promoteSuggestion(id, patch),
    [promoteSuggestion],
  );
  const dismissSuggestion = React.useCallback(
    (id: string) => setSuggestions((prev) => prev.filter((s) => s.id !== id)),
    [],
  );

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
    return <DesktopOnlyFallback />;
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

      {/* Tool palette */}
      <div className="flex flex-wrap items-center gap-xs">
        {FIELD_TYPES.map((type) => (
          <FieldTool key={type} type={type} onAdd={() => addAtCenter(type)} />
        ))}
        <AutoPlaceButton loading={autoStatus === 'loading'} onRun={runAutoPlace} />
        <span className="ml-auto text-xs font-medium text-foreground-subtle">
          이 페이지에 {pageFieldCount}개 · 전체 {fields.length}개
        </span>
      </div>

      <AutoPlaceNotice status={autoStatus} count={suggestions.length} />

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
          onSuggestionAccept={acceptSuggestion}
          onSuggestionChange={changeSuggestion}
          onSuggestionDismiss={dismissSuggestion}
          onPageCount={setPageCount}
          className="max-h-[60vh]"
        />

        {fields.length === 0 && suggestions.length === 0 ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-md text-center text-xs font-medium text-foreground-subtle">
            위 도구를 PDF 위로 끌어다 놓거나 ‘자동 배치’로 시작하세요
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
 * Runs auto-placement. Styled as the palette's primary action (solid brand fill)
 * so it reads as "do this for me" against the outlined manual tools beside it.
 * While a run is in flight it shows a spinner and disables to prevent re-entry.
 */
function AutoPlaceButton({ loading, onRun }: { loading: boolean; onRun: () => void }) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={loading}
      aria-label="문서를 분석해 서명 필드를 자동으로 추천 배치"
      aria-busy={loading}
      className={cn(
        'inline-flex items-center gap-xs rounded-md border border-primary bg-primary px-sm py-2xs',
        'text-sm font-semibold text-primary-foreground shadow-xs',
        'transition-[transform,background-color,opacity] duration-fast ease-standard',
        'hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.97]',
        'disabled:cursor-progress disabled:opacity-70',
      )}
    >
      <span className="flex h-6 w-6 items-center justify-center">
        {loading ? <SpinnerIcon /> : <SparkleIcon />}
      </span>
      {loading ? '분석 중…' : '자동 배치'}
    </button>
  );
}

/**
 * Guidance for each auto-placement outcome. Recommendations are self-evident on
 * the canvas (dotted "추천" boxes), so `ready` reminds the user how to confirm
 * them; `empty`/`error` reassure that manual placement still works; `idle`/
 * `loading` say nothing (the button already carries that state).
 */
function AutoPlaceNotice({ status, count }: { status: AutoPlaceStatus; count: number }) {
  if (status === 'ready' && count > 0) {
    return (
      <p role="status" className="text-xs font-medium text-foreground-subtle">
        점선으로 표시된 추천 필드 {count}개를 확인해 주세요. 수락하거나 위치·크기를 다듬으면 확정돼요.
      </p>
    );
  }
  if (status === 'empty') {
    return (
      <p role="status" className="text-xs font-medium text-foreground-subtle">
        자동으로 넣을 만한 위치를 찾지 못했어요. 위 도구를 끌어다 직접 배치해 주세요.
      </p>
    );
  }
  if (status === 'error') {
    return (
      <p role="alert" className="text-xs font-medium text-danger">
        자동 배치에 실패했어요. 잠시 후 다시 시도하거나 직접 배치해 주세요.
      </p>
    );
  }
  return null;
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

function SparkleIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M10 3l1.4 3.6L15 8l-3.6 1.4L10 13l-1.4-3.6L5 8l3.6-1.4L10 3z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M15 13l.7 1.8L17.5 15.5l-1.8.7L15 18l-.7-1.8L12.5 15.5l1.8-.7L15 13z" fill="currentColor" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 animate-spin" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      <path d="M17 10a7 7 0 00-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
