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
 *   • multi-select — Shift/Cmd(Ctrl)+click toggles a field in the selection;
 *     a plain click selects a single field; empty-canvas click or Esc clears all.
 *     Each selected field shows the same selection indicator (ring/border).
 *   • marquee — pointer-drag on empty canvas draws a selection box; every field
 *     it crosses is selected on release (union with the current selection when a
 *     modifier is held). A drag under a few px is treated as an empty click.
 *   • keyboard — focus a field, arrows move, Shift+arrows resize, Delete removes,
 *     Cmd/Ctrl+D duplicates the current selection (parent owns the geometry).
 *     A plain arrow nudges the WHOLE current-page selection together (group
 *     clamp, relative layout preserved); Delete/Backspace removes every selected
 *     field at once. Single-select flows through the same group path (size 1).
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
  rectFromPoints,
  marqueeHitTest,
  translateNormRects,
  FIELD_TYPE_META,
  RESIZE_HANDLES,
  type PageSize,
  type PxRect,
  type NormRect,
  type SignFieldType,
  type ResizeHandle,
  type SnapLine,
} from '@/lib/field-geometry';
import type { SignFieldDraft } from './wizard-context';

const SNAP_THRESHOLD = 6; // px
/** Below this drag distance a marquee counts as a plain click (clears selection). */
const MARQUEE_MIN_DRAG = 3; // px
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
  /** Currently selected field ids (multi-select). Empty = nothing selected. */
  selectedIds: string[];
  /** Replace the full selection (single source lives in wizard state). */
  onSelectionChange: (ids: string[]) => void;
  /** Replace the full field list (single source lives in wizard state). */
  onFieldsChange: (fields: SignFieldDraft[]) => void;
  /** Duplicate the current selection (Cmd/Ctrl+D). Parent owns the geometry. */
  onDuplicate?: () => void;
  /**
   * Nudge the whole current-page selection by one shared normalized delta (plain
   * arrow keys). Parent owns the geometry (group clamp via `translateNormRects`),
   * so relative layout is preserved; single-select is the size-1 case.
   */
  onNudgeSelected?: (dxNorm: number, dyNorm: number) => void;
  /** Delete every selected field at once, then clear the selection (Delete/Backspace). */
  onDeleteSelected?: () => void;
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
      // Group move: drag one field of a multi-selection and every selected field
      // on this page follows by the SAME delta (relative layout preserved). Start
      // geometry is kept in normalized space so the group can be clamped as one
      // rigid box via `translateNormRects` (see field-box「이동/삭제 모델」).
      kind: 'move-group';
      ids: string[];
      startNorm: NormRect[];
      startX: number;
      startY: number;
    }
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
  selectedIds,
  onSelectionChange,
  onFieldsChange,
  onDuplicate,
  onNudgeSelected,
  onDeleteSelected,
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
  // Live gesture rects + guides, kept local so dragging re-renders cheaply. Maps
  // field id → its in-flight px rect: one entry for a single move/resize, one per
  // selected field for a group move.
  const [liveRects, setLiveRects] = React.useState<Record<string, PxRect> | null>(null);
  const [guides, setGuides] = React.useState<SnapLine[]>([]);
  const gestureRef = React.useRef<Gesture | null>(null);
  // Marquee (rubber-band) selection: anchor + whether it unions the prior set.
  const marqueeRef = React.useRef<{
    startX: number;
    startY: number;
    additive: boolean;
    base: string[];
  } | null>(null);
  const [marquee, setMarquee] = React.useState<PxRect | null>(null);

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

  // --- selection (multi-select) --------------------------------------------

  /** Replace the selection with just this field (plain click / drag / resize). */
  const selectOnly = React.useCallback(
    (id: string) => onSelectionChange([id]),
    [onSelectionChange],
  );

  /** Add/remove a field from the selection (Shift/Cmd/Ctrl+click). */
  const toggleSelect = React.useCallback(
    (id: string) =>
      onSelectionChange(
        selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
      ),
    [selectedIds, onSelectionChange],
  );

  /** Clear all selection (empty-canvas click / Esc). */
  const clearSelection = React.useCallback(() => {
    if (selectedIds.length > 0) onSelectionChange([]);
  }, [selectedIds, onSelectionChange]);

  const removeField = React.useCallback(
    (id: string) => {
      onFieldsChange(fields.filter((f) => f.id !== id));
      if (selectedIds.includes(id)) onSelectionChange(selectedIds.filter((x) => x !== id));
    },
    [fields, onFieldsChange, selectedIds, onSelectionChange],
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
      selectOnly(id);
    },
    [fields, onFieldsChange, selectOnly, page, pageSize],
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
        setLiveRects({ [g.id]: final });
      } else if (g.kind === 'move-group') {
        // Translate the pixel drag into a normalized delta (y flips: canvas-down is
        // norm-down), clamp the whole group as one box, then re-project to px for
        // live feedback. Snap guides are skipped for group moves by design.
        const dxNorm = dx / (pageSize.width || 1);
        const dyNorm = -dy / (pageSize.height || 1);
        const moved = translateNormRects(g.startNorm, dxNorm, dyNorm);
        const rects: Record<string, PxRect> = {};
        g.ids.forEach((id, i) => {
          rects[id] = normToPx(moved[i]!, pageSize);
        });
        setGuides([]);
        setLiveRects(rects);
      } else {
        const resized = clampPxRect(resizePxRect(g.startRect, g.handle, dx, dy), pageSize);
        setLiveRects({ [g.id]: resized });
        setGuides([]);
      }
    },
    [pageSize, peerRects],
  );

  const endGesture = React.useCallback(
    (event: React.PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      const live = liveRects;
      gestureRef.current = null;
      setGuides([]);
      setLiveRects(null);
      try {
        (event.target as Element).releasePointerCapture?.(event.pointerId);
      } catch {
        /* capture may already be gone */
      }
      if (!live) return;
      if (g.kind === 'move-group') {
        // Commit all selected fields in one `onFieldsChange` pass so the group
        // moves as a single edit. Per-rect clamp here is a no-op (the group clamp
        // already kept every rect in-page), so relative layout survives the commit.
        const patches = new Map<string, NormRect>();
        for (const id of g.ids) {
          const px = live[id];
          if (px) patches.set(id, clampNormRect(pxToNorm(px, pageSize)));
        }
        if (patches.size > 0) {
          onFieldsChange(fields.map((f) => ({ ...f, ...(patches.get(f.id) ?? {}) })));
        }
        return;
      }
      const px = live[g.id];
      if (px) updateField(g.id, clampNormRect(pxToNorm(px, pageSize)));
    },
    [liveRects, pageSize, updateField, fields, onFieldsChange],
  );

  const startMove = React.useCallback(
    (event: React.PointerEvent, field: SignFieldDraft) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      // Shift/Cmd(Ctrl)+click toggles selection membership without moving.
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        toggleSelect(field.id);
        return;
      }
      // Dragging a field that is part of a multi-selection moves the whole group
      // (relative layout preserved) without collapsing the selection. Only fields
      // on this page participate.
      if (selectedIds.length > 1 && selectedIds.includes(field.id)) {
        const groupFields = pageFields.filter((f) => selectedIds.includes(f.id));
        const rects: Record<string, PxRect> = {};
        for (const gf of groupFields) rects[gf.id] = normToPx(gf, pageSize);
        gestureRef.current = {
          kind: 'move-group',
          ids: groupFields.map((f) => f.id),
          startNorm: groupFields.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
          startX: event.clientX,
          startY: event.clientY,
        };
        setLiveRects(rects);
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        return;
      }
      // Plain click on an unselected/single field: collapse to a single selection
      // and start dragging it.
      selectOnly(field.id);
      const startRect = normToPx(field, pageSize);
      gestureRef.current = { kind: 'move', id: field.id, startRect, startX: event.clientX, startY: event.clientY };
      setLiveRects({ [field.id]: startRect });
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    },
    [selectOnly, toggleSelect, pageSize, pageFields, selectedIds],
  );

  const startResize = React.useCallback(
    (event: React.PointerEvent, field: SignFieldDraft, handle: ResizeHandle) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      selectOnly(field.id);
      const startRect = normToPx(field, pageSize);
      gestureRef.current = {
        kind: 'resize',
        id: field.id,
        handle,
        startRect,
        startX: event.clientX,
        startY: event.clientY,
      };
      setLiveRects({ [field.id]: startRect });
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    },
    [selectOnly, pageSize],
  );

  // --- marquee (rubber-band) selection on empty canvas ---------------------

  /** Overlay-local point for a pointer event, clamped inside the page raster. */
  const overlayPoint = React.useCallback(
    (event: React.PointerEvent) => {
      const bounds = overlayRef.current?.getBoundingClientRect();
      const x = event.clientX - (bounds?.left ?? 0);
      const y = event.clientY - (bounds?.top ?? 0);
      return {
        x: Math.min(pageSize.width, Math.max(0, x)),
        y: Math.min(pageSize.height, Math.max(0, y)),
      };
    },
    [pageSize],
  );

  const startMarquee = React.useCallback(
    (event: React.PointerEvent) => {
      // Only the empty overlay starts a marquee — field bodies stop propagation.
      if (event.button !== 0 || event.target !== event.currentTarget) return;
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      marqueeRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        additive,
        base: additive ? selectedIds : [],
      };
      const p = overlayPoint(event);
      setMarquee({ left: p.x, top: p.y, width: 0, height: 0 });
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    },
    [selectedIds, overlayPoint],
  );

  const onMarqueePointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      const m = marqueeRef.current;
      if (!m) return;
      const bounds = overlayRef.current?.getBoundingClientRect();
      const anchor = { x: m.startX - (bounds?.left ?? 0), y: m.startY - (bounds?.top ?? 0) };
      const cur = overlayPoint(event);
      setMarquee(rectFromPoints(anchor, cur));
    },
    [overlayPoint],
  );

  const endMarquee = React.useCallback(
    (event: React.PointerEvent) => {
      const m = marqueeRef.current;
      if (!m) return;
      const box = marquee;
      marqueeRef.current = null;
      setMarquee(null);
      try {
        (event.target as Element).releasePointerCapture?.(event.pointerId);
      } catch {
        /* capture may already be gone */
      }
      // A negligible drag is a plain empty-canvas click: clear unless modified.
      if (!box || (box.width < MARQUEE_MIN_DRAG && box.height < MARQUEE_MIN_DRAG)) {
        if (!m.additive) clearSelection();
        return;
      }
      const hits = marqueeHitTest(
        box,
        pageFields.map((f) => ({ id: f.id, rect: normToPx(f, pageSize) })),
      );
      const next = m.additive
        ? [...m.base, ...hits.filter((id) => !m.base.includes(id))]
        : hits;
      onSelectionChange(next);
    },
    [marquee, pageFields, pageSize, clearSelection, onSelectionChange],
  );

  // --- keyboard assist (move / resize / delete a focused field) ------------

  const onFieldKeyDown = React.useCallback(
    (event: React.KeyboardEvent, field: SignFieldDraft) => {
      const step = event.shiftKey ? NUDGE_PX_LARGE : NUDGE_PX;
      // Cmd/Ctrl+D duplicates the current selection (browser's bookmark default
      // is suppressed). The focused field is always part of the selection, so
      // single- and multi-select both flow through the parent's duplicator.
      if ((event.metaKey || event.ctrlKey) && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        onDuplicate?.();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        clearSelection();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        // Delete removes the WHOLE selection at once when the focused field is
        // part of it (single- and multi-select share this path); a focused but
        // unselected field falls back to removing just itself (no regression).
        if (onDeleteSelected && selectedIds.includes(field.id)) {
          onDeleteSelected();
        } else {
          removeField(field.id);
        }
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
      // Shift+arrow = resize the focused field's bottom-right corner. This stays a
      // single-field op (group resize is out of scope), so it commits directly.
      if (event.shiftKey) {
        const base = normToPx(field, pageSize);
        const next = resizePxRect(base, 'se', delta[0], delta[1]);
        updateField(field.id, clampNormRect(pxToNorm(clampPxRect(next, pageSize), pageSize)));
        return;
      }
      // Plain arrow = move the whole current-page selection together by one nudge.
      // Convert the px step to a normalized delta (y flips: canvas-down = norm-down)
      // and hand it to the parent, which group-clamps via `translateNormRects` so
      // the selection moves as one rigid box (relative layout preserved). Single-
      // select is the size-1 case. A focused-but-unselected field falls back to a
      // lone move so keyboard focus without a selection still nudges (no regression).
      if (onNudgeSelected && selectedIds.includes(field.id)) {
        onNudgeSelected(delta[0] / (pageSize.width || 1), -delta[1] / (pageSize.height || 1));
        return;
      }
      const base = normToPx(field, pageSize);
      const next = { ...base, left: base.left + delta[0], top: base.top + delta[1] };
      updateField(field.id, clampNormRect(pxToNorm(clampPxRect(next, pageSize), pageSize)));
    },
    [pageSize, removeField, updateField, clearSelection, onDuplicate, onNudgeSelected, onDeleteSelected, selectedIds],
  );

  const rectFor = (field: SignFieldDraft): PxRect =>
    liveRects?.[field.id] ?? normToPx(field, pageSize);

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
          onPointerDown={startMarquee}
          onPointerMove={onMarqueePointerMove}
          onPointerUp={endMarquee}
        >
          {/* Marquee selection box */}
          {marquee ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute rounded-xs border border-primary bg-primary-subtle/40"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.width,
                height: marquee.height,
              }}
            />
          ) : null}

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
            const selected = selectedIds.includes(field.id);
            const hovered = hoverId === field.id;
            const dragging = liveRects?.[field.id] != null;
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
