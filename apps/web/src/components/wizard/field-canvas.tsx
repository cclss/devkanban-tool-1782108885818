'use client';

/**
 * The interactive PDF page + field overlay (desktop placement surface).
 *
 * Renders one page of the open document into a raster `<canvas>` (pointer-inert)
 * and lays an absolutely-positioned overlay of exactly the rendered CSS size on
 * top. Fields are positioned from their normalized model via `normToPx`, so they
 * track the page through zoom and page changes; on every commit they are
 * converted back with `pxToNorm` + clamped, keeping the stored geometry valid
 * and round-trip-stable.
 *
 * Interactions:
 *   • place — drop a palette tool (HTML5 DnD) onto the page, centered at cursor
 *   • move  — pointer-drag a field body (pointer capture, snap guides)
 *   • resize— pointer-drag any of 8 handles
 *   • select/hover — click / pointer-enter, with clear visual feedback
 *   • keyboard — focus a field, arrows move, Shift+arrows resize, Delete removes
 */

import * as React from 'react';
import { cn } from '@repo/ui';
import {
  openPdf,
  renderPageToCanvas,
  isRenderCancelled,
  PdfRenderError,
  type PdfDocument,
} from '@/lib/pdf';
import {
  normToPx,
  pxToNorm,
  clampPxRect,
  clampNormRect,
  defaultPxRectAt,
  resizePxRect,
  snapMove,
  FIELD_TYPE_META,
  RESIZE_HANDLES,
  type PageSize,
  type PxRect,
  type SignFieldType,
  type ResizeHandle,
  type SnapLine,
} from '@/lib/field-geometry';
import type { SignFieldDraft } from './wizard-context';
// Field ids come from a shared, DOM-free counter so canvas-placed and
// AI-suggested fields (lib/send.ts) never collide. Re-exported for existing
// callers that import it from here (e.g. fields-step).
import { nextFieldId } from '@/lib/field-id';
export { nextFieldId };

const SNAP_THRESHOLD = 6; // px
const NUDGE_PX = 1;
const NUDGE_PX_LARGE = 12;
/** dataTransfer key carrying the field type during a palette → canvas drag. */
export const FIELD_DND_TYPE = 'application/x-esign-field';

type RenderStatus = 'loading' | 'ready' | 'error';

interface FieldCanvasProps {
  file: File;
  page: number;
  zoom: number;
  /** Available width (px) the page fits into at zoom 1. */
  fitWidth: number;
  fields: SignFieldDraft[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Replace the full field list (single source lives in wizard state). */
  onFieldsChange: (fields: SignFieldDraft[]) => void;
  /** Report rendered page count once the document opens. */
  onPageCount?: (count: number) => void;
  className?: string;
}

/** Active pointer gesture transient state (px space, current page). */
type Gesture =
  | { kind: 'move'; id: string; startRect: PxRect; startX: number; startY: number }
  | {
      kind: 'resize';
      id: string;
      handle: ResizeHandle;
      startRect: PxRect;
      startX: number;
      startY: number;
    };

export function FieldCanvas({
  file,
  page,
  zoom,
  fitWidth,
  fields,
  selectedId,
  onSelect,
  onFieldsChange,
  onPageCount,
  className,
}: FieldCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const docRef = React.useRef<PdfDocument | null>(null);

  const [status, setStatus] = React.useState<RenderStatus>('loading');
  const [docReady, setDocReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pageSize, setPageSize] = React.useState<PageSize>({ width: fitWidth, height: fitWidth * 1.414 });
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  // Live gesture rect + guides, kept local so dragging re-renders cheaply.
  const [liveRect, setLiveRect] = React.useState<{ id: string; rect: PxRect } | null>(null);
  const [guides, setGuides] = React.useState<SnapLine[]>([]);
  const gestureRef = React.useRef<Gesture | null>(null);

  const onPageCountRef = React.useRef(onPageCount);
  React.useEffect(() => {
    onPageCountRef.current = onPageCount;
  }, [onPageCount]);

  // Open the document once; dispose on unmount. `docReady` gates the render
  // effect so the first page draws as soon as the handle is available.
  React.useEffect(() => {
    let disposed = false;
    setStatus('loading');
    setDocReady(false);
    openPdf(file)
      .then(({ doc, pageCount }) => {
        if (disposed) {
          void doc.destroy();
          return;
        }
        docRef.current = doc;
        onPageCountRef.current?.(pageCount);
        setDocReady(true);
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });
    return () => {
      disposed = true;
      setDocReady(false);
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [file]);

  const cssWidth = Math.round(fitWidth * zoom);

  // Render the current page whenever it, the zoom, or the open document changes.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const doc = docRef.current;
    if (!canvas || !docReady || !doc) return;
    let cancelled = false;

    const run = async () => {
      setStatus('loading');
      try {
        const { cssWidth: w, cssHeight: h } = await renderPageToCanvas(doc, page, canvas, cssWidth);
        if (cancelled) return;
        setPageSize({ width: w, height: h });
        setStatus('ready');
        setError(null);
      } catch (err) {
        if (cancelled || isRenderCancelled(err)) return;
        setError(
          err instanceof PdfRenderError
            ? err.message
            : 'PDF를 읽을 수 없어요. 파일이 손상되지 않았는지 확인해 주세요.',
        );
        setStatus('error');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [docReady, page, cssWidth]);

  const pageFields = React.useMemo(() => fields.filter((f) => f.page === page), [fields, page]);

  const updateField = React.useCallback(
    (id: string, patch: Partial<SignFieldDraft>) => {
      onFieldsChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    },
    [fields, onFieldsChange],
  );

  const removeField = React.useCallback(
    (id: string) => {
      onFieldsChange(fields.filter((f) => f.id !== id));
      if (selectedId === id) onSelect(null);
    },
    [fields, onFieldsChange, selectedId, onSelect],
  );

  // --- placement (HTML5 drag-and-drop from the palette) --------------------

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(FIELD_DND_TYPE) as SignFieldType;
      if (!type || !FIELD_TYPE_META[type]) return;
      const overlay = overlayRef.current;
      if (!overlay) return;
      const rect = overlay.getBoundingClientRect();
      const center = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const px = defaultPxRectAt(type, center, pageSize);
      const norm = clampNormRect(pxToNorm(px, pageSize));
      const id = nextFieldId();
      onFieldsChange([...fields, { id, type, page, ...norm }]);
      onSelect(id);
    },
    [fields, onFieldsChange, onSelect, page, pageSize],
  );

  // --- move / resize (pointer events with capture) -------------------------

  const peerRects = React.useCallback(
    (excludeId: string): PxRect[] =>
      pageFields.filter((f) => f.id !== excludeId).map((f) => normToPx(f, pageSize)),
    [pageFields, pageSize],
  );

  const onGesturePointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;

      if (g.kind === 'move') {
        let moved: PxRect = { ...g.startRect, left: g.startRect.left + dx, top: g.startRect.top + dy };
        moved = clampPxRect(moved, pageSize);
        const snapped = snapMove(moved, pageSize, peerRects(g.id), SNAP_THRESHOLD);
        const final = clampPxRect(snapped.rect, pageSize);
        setGuides(snapped.guides);
        setLiveRect({ id: g.id, rect: final });
      } else {
        const resized = clampPxRect(resizePxRect(g.startRect, g.handle, dx, dy), pageSize);
        setLiveRect({ id: g.id, rect: resized });
        setGuides([]);
      }
    },
    [pageSize, peerRects],
  );

  const endGesture = React.useCallback(
    (event: React.PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      const live = liveRect;
      gestureRef.current = null;
      setGuides([]);
      setLiveRect(null);
      try {
        (event.target as Element).releasePointerCapture?.(event.pointerId);
      } catch {
        /* capture may already be gone */
      }
      if (live && live.id === g.id) {
        updateField(g.id, clampNormRect(pxToNorm(live.rect, pageSize)));
      }
    },
    [liveRect, pageSize, updateField],
  );

  const startMove = React.useCallback(
    (event: React.PointerEvent, field: SignFieldDraft) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      onSelect(field.id);
      const startRect = normToPx(field, pageSize);
      gestureRef.current = { kind: 'move', id: field.id, startRect, startX: event.clientX, startY: event.clientY };
      setLiveRect({ id: field.id, rect: startRect });
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    },
    [onSelect, pageSize],
  );

  const startResize = React.useCallback(
    (event: React.PointerEvent, field: SignFieldDraft, handle: ResizeHandle) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      onSelect(field.id);
      const startRect = normToPx(field, pageSize);
      gestureRef.current = {
        kind: 'resize',
        id: field.id,
        handle,
        startRect,
        startX: event.clientX,
        startY: event.clientY,
      };
      setLiveRect({ id: field.id, rect: startRect });
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    },
    [onSelect, pageSize],
  );

  // --- keyboard assist (move / resize / delete a focused field) ------------

  const onFieldKeyDown = React.useCallback(
    (event: React.KeyboardEvent, field: SignFieldDraft) => {
      const step = event.shiftKey ? NUDGE_PX_LARGE : NUDGE_PX;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeField(field.id);
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = arrows[event.key];
      if (!delta) return;
      event.preventDefault();
      const base = normToPx(field, pageSize);
      let next: PxRect;
      if (event.shiftKey) {
        // Shift = resize the bottom-right corner.
        next = resizePxRect(base, 'se', delta[0], delta[1]);
      } else {
        next = { ...base, left: base.left + delta[0], top: base.top + delta[1] };
      }
      updateField(field.id, clampNormRect(pxToNorm(clampPxRect(next, pageSize), pageSize)));
    },
    [pageSize, removeField, updateField],
  );

  const rectFor = (field: SignFieldDraft): PxRect =>
    liveRect && liveRect.id === field.id ? liveRect.rect : normToPx(field, pageSize);

  return (
    <div className={cn('relative w-full overflow-auto', className)}>
      <div
        className="relative mx-auto"
        style={{ width: pageSize.width, height: pageSize.height }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`계약 PDF ${page}페이지`}
          className="pointer-events-none absolute inset-0 rounded-sm border border-border bg-surface shadow-sm"
        />

        {status === 'loading' ? (
          <div
            aria-hidden="true"
            className="skeleton-shimmer absolute inset-0 animate-shimmer rounded-sm"
          />
        ) : null}

        {status === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-xs rounded-sm border border-border bg-surface-muted px-md text-center">
            <p className="text-sm text-foreground-muted">{error}</p>
          </div>
        ) : null}

        {/* Field overlay — receives drops + clears selection on empty click. */}
        <div
          ref={overlayRef}
          className="absolute inset-0"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={onDrop}
          onPointerDown={() => onSelect(null)}
        >
          {/* Snap guides */}
          {guides.map((g, i) =>
            g.axis === 'x' ? (
              <span
                key={`gx-${i}`}
                aria-hidden="true"
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary/70"
                style={{ left: g.pos }}
              />
            ) : (
              <span
                key={`gy-${i}`}
                aria-hidden="true"
                className="pointer-events-none absolute left-0 right-0 h-px bg-primary/70"
                style={{ top: g.pos }}
              />
            ),
          )}

          {pageFields.map((field) => {
            const rect = rectFor(field);
            const selected = selectedId === field.id;
            const hovered = hoverId === field.id;
            const dragging = liveRect?.id === field.id;
            return (
              <FieldBox
                key={field.id}
                field={field}
                rect={rect}
                selected={selected}
                hovered={hovered}
                dragging={dragging}
                onPointerEnter={() => setHoverId(field.id)}
                onPointerLeave={() => setHoverId((h) => (h === field.id ? null : h))}
                onPointerDownBody={(e) => startMove(e, field)}
                onPointerDownHandle={(e, h) => startResize(e, field, h)}
                onPointerMove={onGesturePointerMove}
                onPointerUp={endGesture}
                onKeyDown={(e) => onFieldKeyDown(e, field)}
                onDelete={() => removeField(field.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface FieldBoxProps {
  field: SignFieldDraft;
  rect: PxRect;
  selected: boolean;
  hovered: boolean;
  dragging: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onPointerDownBody: (e: React.PointerEvent) => void;
  onPointerDownHandle: (e: React.PointerEvent, handle: ResizeHandle) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDelete: () => void;
}

/**
 * Per-state box treatment for a field marker, keyed on whether the field was
 * placed by the user (manual — action-blue `primary`) or drafted by AI auto-place
 * (`source === 'auto'` — violet `ai-accent`). The two share the *exact same* state
 * grammar (idle = dashed border + faint tint; hover/select = solid border + shadow;
 * select also raises the focus ring) so an AI field reads as the same kind of
 * object — only the color axis swaps, which is what tells the two apart at a glance.
 * `ai-accent-strong` text on the `ai-accent-subtle` tint clears WCAG AA.
 */
const MANUAL_STATE_CLASS = {
  selected: 'border-primary bg-primary-subtle/80 text-primary shadow-md ring-2 ring-focus',
  hovered: 'border-primary bg-primary-subtle/60 text-primary shadow-sm',
  idle: 'border-dashed border-primary/60 bg-primary-subtle/40 text-primary/90',
} as const;

const AUTO_STATE_CLASS = {
  selected:
    'border-ai-accent bg-ai-accent-subtle/80 text-ai-accent-strong shadow-md ring-2 ring-focus',
  hovered: 'border-ai-accent bg-ai-accent-subtle/60 text-ai-accent-strong shadow-sm',
  idle: 'border-dashed border-ai-accent/60 bg-ai-accent-subtle/40 text-ai-accent-strong',
} as const;

function FieldBox({
  field,
  rect,
  selected,
  hovered,
  dragging,
  onPointerEnter,
  onPointerLeave,
  onPointerDownBody,
  onPointerDownHandle,
  onPointerMove,
  onPointerUp,
  onKeyDown,
  onDelete,
}: FieldBoxProps) {
  const meta = FIELD_TYPE_META[field.type];
  // AI-drafted fields (source: 'auto') wear the violet ai-accent treatment + an
  // "AI 추천" pin. Editing (move/resize/nudge) only patches geometry, so `source`
  // survives — a suggestion stays a suggestion until it is deleted, never silently
  // "converted" to manual by being adjusted (spec: suggested-field-marker).
  const isAuto = field.source === 'auto';
  const stateClass = isAuto ? AUTO_STATE_CLASS : MANUAL_STATE_CLASS;
  const state = selected ? 'selected' : hovered ? 'hovered' : 'idle';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${isAuto ? 'AI 추천 ' : ''}${meta.label} 필드. 방향키로 이동, Shift+방향키로 크기 조절, Delete로 삭제`}
      aria-pressed={selected}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDownBody}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      onFocus={onPointerEnter}
      onBlur={onPointerLeave}
      className={cn(
        'group absolute flex select-none items-center justify-center rounded-sm border-2 text-xs font-semibold',
        'outline-none transition-[box-shadow,background-color,border-color]',
        dragging ? 'cursor-grabbing duration-0' : 'cursor-grab duration-fast ease-standard',
        stateClass[state],
      )}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {/* AI-source pin — always on (every state), so the violet color is never the
          only signal: sparkle mark + "AI 추천" label carry it non-chromatically. The
          box's aria-label already announces "AI 추천", so the pin is decorative to SR. */}
      {isAuto ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-2.5 left-0 flex items-center gap-[2px] rounded-full bg-ai-accent-subtle px-1.5 py-[1px] text-2xs font-semibold text-ai-accent-strong shadow-xs ring-1 ring-ai-accent/25"
        >
          <SparkleGlyph />
          AI 추천
        </span>
      ) : null}

      <span className="pointer-events-none flex items-center gap-2xs truncate px-2xs">
        <FieldGlyph type={field.type} />
        {meta.label}
      </span>

      {/* Delete affordance — appears when the field is active. */}
      {selected ? (
        <button
          type="button"
          aria-label={`${isAuto ? 'AI 추천 ' : ''}${meta.label} 필드 삭제`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute -right-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-danger-foreground shadow-sm transition-transform duration-fast hover:scale-110 active:scale-95"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}

      {/* Resize handles — visible on select/hover. Border tracks the field's color
          axis so an AI field's handles stay violet. */}
      {selected || hovered
        ? RESIZE_HANDLES.map((h) => (
            <span
              key={h}
              onPointerDown={(e) => onPointerDownHandle(e, h)}
              className={cn(
                'absolute h-2.5 w-2.5 rounded-full border bg-surface shadow-xs',
                isAuto ? 'border-ai-accent' : 'border-primary',
                HANDLE_POSITION[h],
                HANDLE_CURSOR[h],
              )}
            />
          ))
        : null}
    </div>
  );
}

/**
 * Two-star sparkle — the AI mark. A non-color signal that always accompanies the
 * violet ai-accent tint + "AI 추천" label so the AI source is legible without hue
 * alone (mirrors the palette trigger's mark in fields-step).
 */
function SparkleGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
      <path d="M8 1.5l1.35 3.65L13 6.5l-3.65 1.35L8 11.5 6.65 7.85 3 6.5l3.65-1.35L8 1.5Z" fill="currentColor" />
      <path d="M12.6 10.4l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55.55-1.45Z" fill="currentColor" />
    </svg>
  );
}

const HANDLE_POSITION: Record<ResizeHandle, string> = {
  nw: '-left-1.5 -top-1.5',
  n: 'left-1/2 -top-1.5 -translate-x-1/2',
  ne: '-right-1.5 -top-1.5',
  e: '-right-1.5 top-1/2 -translate-y-1/2',
  se: '-right-1.5 -bottom-1.5',
  s: 'left-1/2 -bottom-1.5 -translate-x-1/2',
  sw: '-left-1.5 -bottom-1.5',
  w: '-left-1.5 top-1/2 -translate-y-1/2',
};

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'cursor-nwse-resize',
  n: 'cursor-ns-resize',
  ne: 'cursor-nesw-resize',
  e: 'cursor-ew-resize',
  se: 'cursor-nwse-resize',
  s: 'cursor-ns-resize',
  sw: 'cursor-nesw-resize',
  w: 'cursor-ew-resize',
};

function FieldGlyph({ type }: { type: SignFieldType }) {
  if (type === 'SIGNATURE') {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
        <path
          d="M2 12c2-1 3-7 5-7s1 5 3 5 2-3 4-3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (type === 'DATE') {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path d="M4 4h8M8 4v8M6.5 12h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
