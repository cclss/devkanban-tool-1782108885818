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
import type { SignFieldSuggestion } from '@/lib/signfield-suggest';
import { SparkleGlyph } from '@/components/ai';

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
  /**
   * Pending AI suggestions to preview on the page. Rendered in the AI-accent
   * treatment, kept visually distinct from `fields`, and not editable until
   * accepted. Empty when there is nothing to suggest.
   */
  suggestions?: SignFieldSuggestion[];
  /** Confirm one suggestion → it becomes an ordinary field. */
  onAcceptSuggestion?: (id: string) => void;
  /** Discard one suggestion without accepting it. */
  onDismissSuggestion?: (id: string) => void;
  /** Report rendered page count once the document opens. */
  onPageCount?: (count: number) => void;
  className?: string;
}

let fieldSeq = 0;
/** Monotonic, collision-resistant id for a newly placed field. */
export function nextFieldId(): string {
  fieldSeq += 1;
  return `field-${fieldSeq}-${Math.round(performance.now())}`;
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
  suggestions,
  onAcceptSuggestion,
  onDismissSuggestion,
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
  const pageSuggestions = React.useMemo(
    () => (suggestions ?? []).filter((s) => s.page === page),
    [suggestions, page],
  );

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

          {/* AI suggestions — distinct accent treatment, accept/dismiss inline.
              Rendered above user fields so a proposal is never hidden behind one. */}
          {pageSuggestions.map((suggestion) => (
            <SuggestionBox
              key={suggestion.id}
              suggestion={suggestion}
              rect={normToPx(suggestion, pageSize)}
              onAccept={() => onAcceptSuggestion?.(suggestion.id)}
              onDismiss={() => onDismissSuggestion?.(suggestion.id)}
            />
          ))}
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
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${meta.label} 필드. 방향키로 이동, Shift+방향키로 크기 조절, Delete로 삭제`}
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
        selected
          ? 'border-primary bg-primary-subtle/80 text-primary shadow-md ring-2 ring-focus'
          : hovered
            ? 'border-primary bg-primary-subtle/60 text-primary shadow-sm'
            : 'border-dashed border-primary/60 bg-primary-subtle/40 text-primary/90',
      )}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <span className="pointer-events-none flex items-center gap-2xs truncate px-2xs">
        <FieldGlyph type={field.type} />
        {meta.label}
      </span>

      {/* Delete affordance — appears when the field is active. */}
      {selected ? (
        <button
          type="button"
          aria-label={`${meta.label} 필드 삭제`}
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

      {/* Resize handles — visible on select/hover. */}
      {selected || hovered
        ? RESIZE_HANDLES.map((h) => (
            <span
              key={h}
              onPointerDown={(e) => onPointerDownHandle(e, h)}
              className={cn(
                'absolute h-2.5 w-2.5 rounded-full border border-primary bg-surface shadow-xs',
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
 * A pending AI suggestion drawn on the page.
 *
 * Wears the `sign-field-box/ai-suggested` treatment — accent-ai dashed border +
 * accent-ai-subtle fill + sparkle provenance — so it never reads as one of the
 * user's own (primary) fields, and materialises with the shared
 * `accent-ai-entrance` motion. It is intentionally *not* draggable/resizable: a
 * proposal is confirmed or discarded, not edited in place. Hover/focus reveals
 * an 적용 / 해제 toolbar; Enter/Space accepts, Delete/Backspace dismisses.
 */
function SuggestionBox({
  suggestion,
  rect,
  onAccept,
  onDismiss,
}: {
  suggestion: SignFieldSuggestion;
  rect: PxRect;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const meta = FIELD_TYPE_META[suggestion.type];
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onAccept();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDismiss();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`AI 제안: ${meta.label} 필드. Enter로 적용, Delete로 해제`}
      onKeyDown={onKeyDown}
      className={cn(
        'group absolute flex animate-ai-suggest-in select-none items-center justify-center',
        'rounded-sm border-2 border-dashed border-accent-ai/70 bg-accent-ai-subtle/50 text-accent-ai',
        'outline-none transition-[box-shadow,background-color,border-color] duration-fast ease-standard',
        'cursor-pointer hover:border-accent-ai hover:bg-accent-ai-subtle/70',
        'focus-visible:border-accent-ai focus-visible:bg-accent-ai-subtle/70 focus-visible:ring-2 focus-visible:ring-focus-ai',
      )}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <span className="pointer-events-none flex items-center gap-2xs truncate px-2xs text-xs font-semibold">
        <SparkleGlyph className="h-3 w-3 shrink-0" />
        {meta.label}
      </span>

      {/* Accept / dismiss toolbar — revealed on hover or keyboard focus. */}
      <div
        className={cn(
          'absolute -top-3 right-0 flex translate-y-[-2px] items-center gap-2xs',
          'opacity-0 transition-opacity duration-fast',
          'group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      >
        <button
          type="button"
          aria-label={`${meta.label} 제안 적용`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onAccept();
          }}
          className="flex h-6 items-center gap-2xs rounded-full bg-accent-ai px-xs text-2xs font-semibold text-accent-ai-foreground shadow-sm transition-transform duration-fast hover:bg-accent-ai-hover active:scale-95"
        >
          <CheckIcon />
          적용
        </button>
        <button
          type="button"
          aria-label={`${meta.label} 제안 해제`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-foreground-muted shadow-sm transition-colors duration-fast hover:bg-grey-100 hover:text-foreground active:scale-95"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden="true">
      <path d="M2.5 6.5l2.5 2.5 4.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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
