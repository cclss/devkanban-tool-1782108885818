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
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  cn,
} from '@repo/ui';
import { ApiError } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { fetchFieldSuggestions } from '@/lib/send';
import {
  FIELD_TYPE_META,
  FIELD_TYPES,
  clampNormRect,
  type SignFieldType,
} from '@/lib/field-geometry';
import { useWizard, type SignFieldDraft } from './wizard-context';
import { FieldCanvas, FIELD_DND_TYPE, nextFieldId } from './field-canvas';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;
/** Page fits comfortably in the 760px wizard column at zoom 1. */
const BASE_FIT_WIDTH = 640;

/**
 * AI auto-placement copy — kept in one place so the tone stays auditable.
 *
 * Inherits the project base voice (해요체 · 비난 없음 · 다음 행동을 준다) and the
 * AI-copy extension: the AI speaks as a helper, never the decider, and always
 * hands control back to the user ("제안했어요 · 자유롭게 바꿀 수 있어요"). Both the
 * empty ("찾지 못했어요") and failed ("할 수 없어요") outcomes stay calm and offer the
 * manual-placement next step — auto-place is best-effort help and never blames or
 * blocks. The AI identity is carried by the label's "AI" + the sparkle mark
 * (non-color signal), not by color.
 */
const AI_PLACE_COPY = {
  /** Palette trigger — value verb entry point. */
  trigger: 'AI로 자동 배치',
  /** In-progress — stated plainly; the Button also drives spinner/disabled/aria-busy. */
  triggering: '배치하는 중…',
  /** 제안 완료: 대상·개수 + 통제권 안내. */
  done: (count: number) =>
    `AI가 필드 ${count}개를 제안했어요. 확인하고 자유롭게 바꿀 수 있어요.`,
  /** 제안 없음 (텍스트 레이어 없음/앵커 미매칭): 비난 없이 + 직접 배치 안내. */
  empty: 'AI가 제안할 필드를 찾지 못했어요. 원하는 위치에 직접 배치해 주세요.',
  /** 호출 실패: 담담히, 위저드를 막지 않고 + 직접 배치 안내. */
  failed: '지금은 자동 배치를 할 수 없어요. 원하는 위치에 직접 배치해 주세요.',
  /** 덮어쓰기 확인 — 이미 필드가 있을 때 (재)실행 시 먼저 묻는다. */
  confirmTitle: '이미 배치한 필드가 있어요',
  confirmBody: (count: number) =>
    `AI로 자동 배치하면 지금 있는 필드 ${count}개를 지우고 새로 채워요. 계속할까요?`,
  /** 거절/대안 — 자율을 존중하는 담담한 표현(안전한 기본 선택). */
  confirmCancel: '그대로 둘게요',
  /** 수락/진행 — 가치를 담은 동사구(주 액션). */
  confirmProceed: '덮어쓰고 배치',
} as const;

/** Auto-placement request lifecycle, drives the button + result/fallback note. */
type AutoStatus = 'idle' | 'loading' | 'done' | 'empty' | 'error';

export function FieldsStep() {
  const isDesktop = useIsDesktop();
  const { state, dispatch } = useWizard();
  const { file, document, fields } = state;

  const router = useRouter();
  const [page, setPage] = React.useState(1);
  const [zoom, setZoom] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [pageCount, setPageCount] = React.useState(document?.pageCount ?? 0);

  // AI auto-placement lifecycle. `suggestedCount` freezes the last accepted count
  // for the result note; `confirmOpen` gates the overwrite dialog.
  const [autoStatus, setAutoStatus] = React.useState<AutoStatus>('idle');
  const [suggestedCount, setSuggestedCount] = React.useState(0);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const setFields = React.useCallback(
    (next: SignFieldDraft[]) => dispatch({ type: 'SET_FIELDS', fields: next }),
    [dispatch],
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

  // Ask the server to draft field placements and inject them into wizard state.
  // The canvas then renders/edits them exactly like manual fields — the drafts
  // already carry normalized geometry + `source: 'auto'` from fetchFieldSuggestions.
  const runAutoPlace = React.useCallback(async () => {
    if (!document) return;
    setConfirmOpen(false);
    setAutoStatus('loading');
    try {
      const suggestions = await fetchFieldSuggestions(document.id, getToken() ?? undefined);
      if (suggestions.length === 0) {
        // Empty = "nothing to suggest" (scanned PDF, no anchors). Not an error —
        // fall back to manual placement without touching the current fields.
        setAutoStatus('empty');
        return;
      }
      // SET_FIELDS replaces the set — this is the overwrite the dialog confirmed.
      setFields(suggestions);
      setSelectedId(null);
      setSuggestedCount(suggestions.length);
      // Jump to the first page that got a suggestion so results are on screen.
      setPage(Math.min(...suggestions.map((f) => f.page)));
      setAutoStatus('done');
    } catch (err) {
      // A lapsed session bounces to login (matches the send flow); any other
      // failure degrades to a calm manual-placement fallback — auto-place is
      // best-effort help and must never gate the wizard.
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setAutoStatus('error');
    }
  }, [document, router, setFields]);

  // Re-running over existing fields overwrites them, so confirm before doing so.
  const onAutoPlaceClick = React.useCallback(() => {
    if (fields.length > 0) {
      setConfirmOpen(true);
      return;
    }
    void runAutoPlace();
  }, [fields.length, runAutoPlace]);

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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          isLoading={autoStatus === 'loading'}
          disabled={!document}
          onClick={onAutoPlaceClick}
        >
          {autoStatus !== 'loading' ? <SparkleGlyph /> : null}
          {autoStatus === 'loading' ? AI_PLACE_COPY.triggering : AI_PLACE_COPY.trigger}
        </Button>
        <span className="ml-auto text-xs font-medium text-foreground-subtle">
          이 페이지에 {pageFieldCount}개 · 전체 {fields.length}개
        </span>
      </div>

      {/* AI auto-placement result / fallback — polite live region, never an alarm. */}
      {autoStatus === 'done' || autoStatus === 'empty' || autoStatus === 'error' ? (
        <p role="status" className="flex items-center gap-2xs text-sm font-medium text-foreground-muted">
          {autoStatus === 'done' ? <SparkleGlyph /> : null}
          {autoStatus === 'done'
            ? AI_PLACE_COPY.done(suggestedCount)
            : autoStatus === 'empty'
              ? AI_PLACE_COPY.empty
              : AI_PLACE_COPY.failed}
        </p>
      ) : null}

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

      {/* Overwrite confirmation — only reached when fields already exist. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{AI_PLACE_COPY.confirmTitle}</DialogTitle>
            <DialogDescription>{AI_PLACE_COPY.confirmBody(fields.length)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              {AI_PLACE_COPY.confirmCancel}
            </Button>
            <Button variant="primary" onClick={() => void runAutoPlace()}>
              {AI_PLACE_COPY.confirmProceed}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Two-star sparkle — the AI mark (non-color signal accompanying the "AI" label). */
function SparkleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('h-4 w-4', className)} fill="none" aria-hidden="true">
      <path d="M8 1.5l1.35 3.65L13 6.5l-3.65 1.35L8 11.5 6.65 7.85 3 6.5l3.65-1.35L8 1.5Z" fill="currentColor" />
      <path d="M12.6 10.4l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55.55-1.45Z" fill="currentColor" />
    </svg>
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
