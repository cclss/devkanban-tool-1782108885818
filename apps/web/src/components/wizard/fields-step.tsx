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
  alignNormRects,
  clampNormRect,
  distributeNormRects,
  type AlignMode,
  type DistributeAxis,
  type SignFieldType,
} from '@/lib/field-geometry';
import { useWizard, type SignFieldDraft } from './wizard-context';
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
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [pageCount, setPageCount] = React.useState(document?.pageCount ?? 0);
  const [saveOpen, setSaveOpen] = React.useState(false);

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
      setSelectedIds([id]);
    },
    [fields, page, setFields],
  );

  const alignSelected = React.useCallback(
    (mode: AlignMode) => {
      // Only the selected fields on the current page participate; selection is
      // page-scoped, but filter defensively so cross-page ids can never move.
      const selected = new Set(selectedIds);
      const targets = fields.filter((f) => f.page === page && selected.has(f.id));
      if (targets.length < 2) return;

      const aligned = alignNormRects(
        targets.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
        mode,
      );
      // Re-clamp each moved rect into the page, then splice back in place —
      // non-selected fields (and other pages) stay byte-for-byte unchanged.
      const nextById = new Map<string, (typeof aligned)[number]>();
      aligned.forEach((rect, i) => {
        const f = targets[i];
        if (f) nextById.set(f.id, clampNormRect(rect));
      });
      setFields(
        fields.map((f) => {
          const next = nextById.get(f.id);
          return next ? { ...f, ...next } : f;
        }),
      );
    },
    [fields, page, selectedIds, setFields],
  );

  const distributeSelected = React.useCallback(
    (axis: DistributeAxis) => {
      // Same page-scoped, defensive filter as alignSelected — cross-page ids can
      // never move. Distribution needs 3+ (two ends pinned, ≥1 field between).
      const selected = new Set(selectedIds);
      const targets = fields.filter((f) => f.page === page && selected.has(f.id));
      if (targets.length < 3) return;

      const distributed = distributeNormRects(
        targets.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
        axis,
      );
      // Re-clamp + splice back exactly as alignSelected does; non-selected fields
      // and other pages stay byte-for-byte unchanged.
      const nextById = new Map<string, (typeof distributed)[number]>();
      distributed.forEach((rect, i) => {
        const f = targets[i];
        if (f) nextById.set(f.id, clampNormRect(rect));
      });
      setFields(
        fields.map((f) => {
          const next = nextById.get(f.id);
          return next ? { ...f, ...next } : f;
        }),
      );
    },
    [fields, page, selectedIds, setFields],
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

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex flex-col gap-2xs">
          <h2 className="text-xl font-bold text-foreground">서명 필드를 배치해 주세요</h2>
          <p className="text-sm text-foreground-subtle">
            받는 분이 서명할 위치에 필드를 끌어다 놓으세요. 클릭하면 가운데에 추가돼요.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSaveOpen(true)}
          disabled={!canSaveTemplate}
        >
          템플릿으로 저장
        </Button>
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

      {/* Tool palette */}
      <div className="flex flex-wrap items-center gap-xs">
        {FIELD_TYPES.map((type) => (
          <FieldTool key={type} type={type} onAdd={() => addAtCenter(type)} />
        ))}
        <span className="ml-auto text-xs font-medium text-foreground-subtle">
          이 페이지에 {pageFieldCount}개 · 전체 {fields.length}개
        </span>
      </div>

      {/* Alignment toolbar — appears once 2+ fields are selected. */}
      {selectedIds.length >= 2 ? (
        <div className="flex flex-wrap items-center gap-sm rounded-md border border-border bg-surface px-sm py-2xs">
          <span className="text-xs font-medium text-foreground-subtle">
            {selectedIds.length}개 필드 정렬
          </span>
          <div className="flex items-center gap-2xs">
            {(['left', 'hcenter', 'right'] as const).map((mode) => (
              <IconButton key={mode} label={ALIGN_LABELS[mode]} onClick={() => alignSelected(mode)}>
                <AlignIcon mode={mode} />
              </IconButton>
            ))}
            <span aria-hidden="true" className="mx-2xs h-5 w-px bg-border" />
            {(['top', 'vcenter', 'bottom'] as const).map((mode) => (
              <IconButton key={mode} label={ALIGN_LABELS[mode]} onClick={() => alignSelected(mode)}>
                <AlignIcon mode={mode} />
              </IconButton>
            ))}
            {/* Distribute tools — only meaningful with a field between two ends. */}
            {selectedIds.length >= 3 ? (
              <>
                <span aria-hidden="true" className="mx-2xs h-5 w-px bg-border" />
                {(['horizontal', 'vertical'] as const).map((axis) => (
                  <IconButton
                    key={axis}
                    label={DISTRIBUTE_LABELS[axis]}
                    onClick={() => distributeSelected(axis)}
                  >
                    <DistributeIcon axis={axis} />
                  </IconButton>
                ))}
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Page nav + zoom */}
      <div className="flex items-center justify-between gap-sm rounded-md border border-border bg-surface px-sm py-2xs">
        <div className="flex items-center gap-2xs">
          <IconButton
            label="이전 페이지"
            disabled={page <= 1}
            onClick={() => {
              setSelectedIds([]);
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
              setSelectedIds([]);
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
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
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
        Shift 또는 Cmd(Ctrl)+클릭으로 여러 필드를 함께 선택하고, 빈 곳 클릭이나 Esc로 선택을 해제해요.
        2개 이상 선택하면 정렬 도구로 좌·가운데·우, 상·가운데·하 줄맞춤을 할 수 있어요.
        3개 이상 선택하면 가로·세로 균등 분배로 바깥 두 필드는 고정한 채 사이 간격을 고르게 맞출 수 있어요.
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

/** Korean labels for each of the six alignment actions. */
const ALIGN_LABELS: Record<AlignMode, string> = {
  left: '왼쪽 정렬',
  hcenter: '가로 가운데 정렬',
  right: '오른쪽 정렬',
  top: '위쪽 정렬',
  vcenter: '세로 가운데 정렬',
  bottom: '아래쪽 정렬',
};

/**
 * Glyph for an alignment mode: a reference guide line plus two field bars pinned
 * to it. Horizontal modes draw a vertical guide + horizontal bars; vertical modes
 * are the 90°-rotated counterpart.
 */
function AlignIcon({ mode }: { mode: AlignMode }) {
  const common = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const };
  let guide: React.ReactNode;
  let bars: React.ReactNode;

  if (mode === 'left' || mode === 'hcenter' || mode === 'right') {
    const guideX = mode === 'left' ? 4 : mode === 'right' ? 16 : 10;
    // Two bars sharing the guide edge/center; widths differ to read as distinct.
    const bar = (y: number, len: number) => {
      const x1 = mode === 'left' ? guideX : mode === 'right' ? guideX - len : guideX - len / 2;
      return <path d={`M${x1} ${y}h${len}`} {...common} />;
    };
    guide = <path d={`M${guideX} 4v12`} {...common} />;
    bars = (
      <>
        {bar(8, 10)}
        {bar(12, 6)}
      </>
    );
  } else {
    const guideY = mode === 'top' ? 4 : mode === 'bottom' ? 16 : 10;
    const bar = (x: number, len: number) => {
      const y1 = mode === 'top' ? guideY : mode === 'bottom' ? guideY - len : guideY - len / 2;
      return <path d={`M${x} ${y1}v${len}`} {...common} />;
    };
    guide = <path d={`M4 ${guideY}h12`} {...common} />;
    bars = (
      <>
        {bar(8, 10)}
        {bar(12, 6)}
      </>
    );
  }

  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      {guide}
      {bars}
    </svg>
  );
}

/** Korean labels for the two distribute (even-spacing) actions. */
const DISTRIBUTE_LABELS: Record<DistributeAxis, string> = {
  horizontal: '가로 균등 분배',
  vertical: '세로 균등 분배',
};

/**
 * Glyph for a distribute axis: three parallel field bars spread with equal gaps
 * along the axis. Horizontal spreads bars across x (vertical bars); vertical is
 * the 90°-rotated counterpart (horizontal bars stacked down y).
 */
function DistributeIcon({ axis }: { axis: DistributeAxis }) {
  const common = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const };
  const bars =
    axis === 'horizontal'
      ? ['M4 4v12', 'M10 4v12', 'M16 4v12']
      : ['M4 4h12', 'M4 10h12', 'M4 16h12'];
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      {bars.map((d) => (
        <path key={d} d={d} {...common} />
      ))}
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
