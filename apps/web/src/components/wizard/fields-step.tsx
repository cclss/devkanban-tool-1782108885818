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
import { Button, cn } from '@repo/ui';
import {
  FIELD_TYPE_META,
  FIELD_TYPES,
  clampNormRect,
  type SignFieldType,
} from '@/lib/field-geometry';
import { autoPlaceFields } from '@/lib/auto-place';
import {
  isRecommended,
  recommendedFieldsFromCandidates,
  useWizard,
  type SignFieldDraft,
} from './wizard-context';
import { FieldCanvas, FIELD_DND_TYPE, nextFieldId } from './field-canvas';
import { SaveTemplateDialog } from './save-template-dialog';

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
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [autoRunning, setAutoRunning] = React.useState(false);
  // Outcome of the last auto-place run, shown inline (never a toast). `placed`
  // summarizes what was suggested; `none` is the no-anchor guidance that keeps
  // the user moving to manual placement. Cleared as soon as a new run starts.
  const [autoNotice, setAutoNotice] =
    React.useState<{ kind: 'placed' | 'none'; count: number } | null>(null);

  const setFields = React.useCallback(
    (next: SignFieldDraft[]) => dispatch({ type: 'SET_FIELDS', fields: next }),
    [dispatch],
  );

  const runAutoPlace = React.useCallback(async () => {
    if (!file || autoRunning) return;
    setAutoRunning(true);
    setAutoNotice(null);
    try {
      // autoPlaceFields never throws — a corrupt/scanned/anchor-less PDF returns
      // [], so manual placement always stays available (no screen break).
      const candidates = await autoPlaceFields(file);
      const drafts = recommendedFieldsFromCandidates(candidates, nextFieldId);
      dispatch({ type: 'ADD_RECOMMENDED_FIELDS', fields: drafts });
      setAutoNotice({ kind: drafts.length > 0 ? 'placed' : 'none', count: drafts.length });
    } finally {
      setAutoRunning(false);
    }
  }, [file, autoRunning, dispatch]);

  const acceptField = React.useCallback(
    (id: string) => dispatch({ type: 'ACCEPT_FIELD', id }),
    [dispatch],
  );
  const acceptAllRecommended = React.useCallback(() => {
    dispatch({ type: 'ACCEPT_ALL_RECOMMENDED' });
    setAutoNotice(null);
  }, [dispatch]);
  const clearRecommended = React.useCallback(() => {
    dispatch({ type: 'CLEAR_RECOMMENDED' });
    setAutoNotice(null);
  }, [dispatch]);

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
  // Saving needs the uploaded PDF's storage key and at least one placed field.
  const canSaveTemplate = fields.length > 0 && Boolean(document?.storageKey);
  const recommendedCount = fields.filter(isRecommended).length;

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex flex-col gap-2xs">
          <h2 className="text-xl font-bold text-foreground">서명 필드를 배치해 주세요</h2>
          <p className="text-sm text-foreground-subtle">
            받는 분이 서명할 위치에 필드를 끌어다 놓으세요. 클릭하면 가운데에 추가돼요.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-xs">
          <Button
            variant="secondary"
            size="sm"
            onClick={runAutoPlace}
            isLoading={autoRunning}
          >
            {!autoRunning ? <SparkleIcon /> : null}
            {autoRunning ? '자동으로 배치 중…' : '자동으로 배치'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSaveOpen(true)}
            disabled={!canSaveTemplate}
          >
            템플릿으로 저장
          </Button>
        </div>
      </div>

      {document?.storageKey ? (
        <SaveTemplateDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          storageKey={document.storageKey}
          pageCount={pageCount > 0 ? pageCount : undefined}
          fields={fields}
        />
      ) : null}

      {/* Auto-place outcome — inline (never a toast).
          • placed → recommendation-toned summary (purple).
          • none   → neutral/info guidance, NOT a failure: it reads as "place them
            yourself", distinct from the canvas's danger-toned "PDF를 읽을 수 없어요". */}
      {autoNotice ? (
        <div
          role="status"
          className={cn(
            'flex items-start gap-xs rounded-md border px-sm py-xs text-sm text-foreground',
            autoNotice.kind === 'placed'
              ? 'border-recommended bg-recommended-subtle'
              : 'border-border bg-surface-muted',
          )}
        >
          <span
            className={cn(
              'mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
              autoNotice.kind === 'placed'
                ? 'bg-recommended text-recommended-foreground'
                : 'bg-grey-200 text-foreground-muted',
            )}
          >
            {autoNotice.kind === 'placed' ? (
              <SparkleIcon className="h-2.5 w-2.5" />
            ) : (
              <InfoIcon />
            )}
          </span>
          <p>
            {autoNotice.kind === 'placed'
              ? `추천 필드 ${autoNotice.count}개를 넣었어요. 확인하고 수락해 주세요.`
              : '자동으로 넣을 서명 위치를 찾지 못했어요. 아래 도구로 직접 배치해 주세요.'}
          </p>
        </div>
      ) : null}

      {/* Batch actions over the remaining recommendations. */}
      {recommendedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-xs rounded-md border border-border bg-surface px-sm py-xs">
          <span className="text-sm font-medium text-foreground">
            추천 필드 {recommendedCount}개
          </span>
          <div className="ml-auto flex items-center gap-xs">
            <Button variant="secondary" size="sm" onClick={acceptAllRecommended}>
              모두 수락
            </Button>
            <Button variant="ghost" size="sm" onClick={clearRecommended}>
              모두 지우기
            </Button>
          </div>
        </div>
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
          onAcceptField={acceptField}
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

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('h-4 w-4', className)} fill="none" aria-hidden="true">
      <path
        d="M8 1.5l1.4 3.6L13 6.5l-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4z"
        fill="currentColor"
      />
      <path d="M13 11l.6 1.5L15 13l-1.4.5L13 15l-.6-1.5L11 13l1.4-.5z" fill="currentColor" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.2v3.4M8 5.2h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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
