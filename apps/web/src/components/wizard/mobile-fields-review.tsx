'use client';

/**
 * Mobile / tablet "확인" (confirm) review screen for the field-placement step.
 *
 * Replaces the old desktop-only block: on a touch / narrow viewport the sender
 * can't comfortably do precise drag-placement, but they CAN review what the AI
 * proposed and confirm it. This surface renders the AI suggestions (and any
 * already-accepted fields) on top of the page preview, lets the sender tap a box
 * to select it, and drives confirm / discard / brief adjustment through large,
 * one-handed touch controls — completing the on-the-go contract-send use case.
 *
 * Scope (grain-3 boundary): review + direct-manipulation adjustment on a touch
 * surface, NOT desktop-grade free drag-and-new-placement.
 *   • suggestions  → tap to select, then 적용 (→ field) / 해제 (discard). Pending
 *     proposals are confirm-or-dismiss, never edited in place (mirrors the
 *     desktop `ai-suggested-canvas` decision) — no drag / resize on a proposal.
 *   • accepted fields → DIRECT MANIPULATION: drag the box to move (pointer
 *     capture, live preview, snap guides, page-edge clamp); drag a corner handle
 *     to resize proportionally or an edge handle for a single axis (handles are
 *     ≥44px touch targets); pinch with two fingers to resize freely. A live
 *     readout shows the move %/size % during the gesture. The directional nudge
 *     pad + size steppers stay as fine-tuning aids in the control bar. Every
 *     geometry edit runs on confirmed fields only, through the same normalized
 *     model + `clampPxRect`/`clampNormRect` guarantee the desktop path uses.
 *   • bulk 모두 적용 / 지우기 live in the shared SuggestionBanner.
 *
 * All motion respects `prefers-reduced-motion` (global fallback collapses
 * transitions to a static end-state; the box follows the finger at duration-0).
 *
 * All analysis / classification is reused from grain-1/2 (`analyzeForSuggestions`)
 * and the grain-4 suggestion/confirm state model — nothing is re-derived here.
 */

import * as React from 'react';
import { cn } from '@repo/ui';
import { SparkleGlyph, SuggestionBanner, type SuggestionBannerState } from '@/components/ai';
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
  clampNormRect,
  clampPxRect,
  resizePxRect,
  snapMove,
  RESIZE_HANDLES,
  FIELD_TYPE_META,
  type PageSize,
  type PxRect,
  type NormRect,
  type ResizeHandle,
  type SnapLine,
} from '@/lib/field-geometry';
import type { SignFieldSuggestion } from '@/lib/signfield-suggest';
import { FieldGlyph } from './field-canvas';
import type { SignFieldDraft } from './wizard-context';

/** One nudge = 2% of the page in the moved axis. Coarse enough for thumb taps. */
const MOVE_STEP = 0.02;
/** Size step factors — grow / shrink the box around its center. */
const GROW = 1.12;
const SHRINK = 0.89;

/** Snap threshold (px) for drag — a touch larger than the desktop's 6px. */
const SNAP_THRESHOLD = 8;
/**
 * Finger travel (px) before a press on a box turns from a *tap* (select) into a
 * *drag* (move). Below this the box doesn't move, so a confirm tap never nudges.
 */
const DRAG_ACTIVATE_PX = 4;

/** Corner handles resize proportionally; edge handles resize a single axis. */
function isCornerHandle(handle: ResizeHandle): boolean {
  return handle.length === 2;
}

/**
 * Proportional corner resize (px space): scale the box uniformly so it keeps its
 * aspect ratio, pinning the corner opposite the dragged one. Caller clamps.
 */
function resizeProportionalPx(start: PxRect, handle: ResizeHandle, dx: number, dy: number): PxRect {
  const raw = resizePxRect(start, handle, dx, dy);
  const scale = Math.max(raw.width / start.width, raw.height / start.height, 0.01);
  const width = start.width * scale;
  const height = start.height * scale;
  const right = start.left + start.width;
  const bottom = start.top + start.height;
  return {
    left: handle.includes('w') ? right - width : start.left,
    top: handle.includes('n') ? bottom - height : start.top,
    width,
    height,
  };
}

/** Distance between two tracked pointer positions (px). */
function pointerDistance(points: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...points.values()];
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Page-relative percentages for the live readout (always 0..100, rounded). */
function pctMove(rect: PxRect, page: PageSize): string {
  const x = Math.round((rect.left / (page.width || 1)) * 100);
  const y = Math.round((rect.top / (page.height || 1)) * 100);
  return `가로 ${x}% · 세로 ${y}%`;
}
function pctSize(rect: PxRect, page: PageSize): string {
  const w = Math.round((rect.width / (page.width || 1)) * 100);
  const h = Math.round((rect.height / (page.height || 1)) * 100);
  return `크기 ${w}% × ${h}%`;
}

/** What the sender currently has selected on the page (page-scoped by render). */
type Selection = { kind: 'suggestion' | 'field'; id: string } | null;

interface MobileFieldsReviewProps {
  file: File;
  fields: SignFieldDraft[];
  suggestions: SignFieldSuggestion[];
  /** Banner state derived upstream (analyzing / ready / empty / error), or null. */
  bannerState: SuggestionBannerState | null;
  /** Accept one suggestion → field; returns the new field id so we can select it. */
  onAcceptSuggestion: (id: string) => string | void;
  onDismissSuggestion: (id: string) => void;
  onApplyAll: () => void;
  onClear: () => void;
  onRetry: () => void;
  /** Replace the full field list (single source lives in wizard state). */
  onFieldsChange: (fields: SignFieldDraft[]) => void;
}

export function MobileFieldsReview({
  file,
  fields,
  suggestions,
  bannerState,
  onAcceptSuggestion,
  onDismissSuggestion,
  onApplyAll,
  onClear,
  onRetry,
  onFieldsChange,
}: MobileFieldsReviewProps) {
  const [page, setPage] = React.useState(1);
  const [pageCount, setPageCount] = React.useState(1);
  const [selection, setSelection] = React.useState<Selection>(null);

  const total = Math.max(pageCount, 1);
  const pageFieldCount = fields.filter((f) => f.page === page).length;
  const pageSuggestionCount = suggestions.filter((s) => s.page === page).length;

  // Selection is page-scoped; a selected item that's no longer present (applied,
  // dismissed, or on another page) clears so the control bar never dangles.
  const selectedField =
    selection?.kind === 'field' ? fields.find((f) => f.id === selection.id) ?? null : null;
  const selectedSuggestion =
    selection?.kind === 'suggestion'
      ? suggestions.find((s) => s.id === selection.id) ?? null
      : null;
  React.useEffect(() => {
    if (selection && !selectedField && !selectedSuggestion) setSelection(null);
  }, [selection, selectedField, selectedSuggestion]);

  const adjustSelectedField = React.useCallback(
    (next: (f: SignFieldDraft) => SignFieldDraft) => {
      if (selection?.kind !== 'field') return;
      onFieldsChange(fields.map((f) => (f.id === selection.id ? next(f) : f)));
    },
    [selection, fields, onFieldsChange],
  );

  const nudge = React.useCallback(
    (dx: number, dy: number) =>
      adjustSelectedField((f) => ({
        ...f,
        ...clampNormRect({ x: f.x + dx, y: f.y + dy, width: f.width, height: f.height }),
      })),
    [adjustSelectedField],
  );

  const resize = React.useCallback(
    (factor: number) =>
      adjustSelectedField((f) => {
        const cx = f.x + f.width / 2;
        const cy = f.y + f.height / 2;
        const width = f.width * factor;
        const height = f.height * factor;
        return { ...f, ...clampNormRect({ x: cx - width / 2, y: cy - height / 2, width, height }) };
      }),
    [adjustSelectedField],
  );

  // Commit a direct-manipulation gesture (drag / handle / pinch) on one field.
  // The canvas drives live preview locally; this writes the settled geometry back
  // to wizard state through the same clamp guarantee every other edit path uses.
  const commitFieldRect = React.useCallback(
    (id: string, rect: NormRect) =>
      onFieldsChange(fields.map((f) => (f.id === id ? { ...f, ...clampNormRect(rect) } : f))),
    [fields, onFieldsChange],
  );

  const deleteSelectedField = React.useCallback(() => {
    if (selection?.kind !== 'field') return;
    onFieldsChange(fields.filter((f) => f.id !== selection.id));
    setSelection(null);
  }, [selection, fields, onFieldsChange]);

  const acceptSelected = React.useCallback(() => {
    if (selection?.kind !== 'suggestion') return;
    const newId = onAcceptSuggestion(selection.id);
    // Re-select as a field so the sender can immediately nudge / resize it.
    setSelection(typeof newId === 'string' ? { kind: 'field', id: newId } : null);
  }, [selection, onAcceptSuggestion]);

  const dismissSelected = React.useCallback(() => {
    if (selection?.kind !== 'suggestion') return;
    onDismissSuggestion(selection.id);
    setSelection(null);
  }, [selection, onDismissSuggestion]);

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-col gap-2xs">
        <h2 className="text-xl font-bold text-foreground">AI가 배치한 서명란을 확인해 주세요</h2>
        <p className="text-sm text-foreground-subtle">
          제안된 서명란을 탭해서 적용하고, 확정한 박스는 끌어서 옮기거나 핸들·두 손가락으로 크기를
          조정할 수 있어요.
        </p>
      </div>

      {/* AI auto-placement summary — non-blocking on mobile too: analyzing /
          empty(0개) / error all surface here as guidance, never a hard block. */}
      {bannerState ? (
        <SuggestionBanner
          state={bannerState}
          onApplyAll={onApplyAll}
          onClear={onClear}
          onRetry={onRetry}
        />
      ) : null}

      {/* Legend — keeps the two box treatments readable without relying on color. */}
      {pageFieldCount > 0 || pageSuggestionCount > 0 ? (
        <div className="flex flex-wrap items-center gap-md text-xs font-medium text-foreground-muted">
          <span className="inline-flex items-center gap-2xs">
            <span className="h-3 w-3 rounded-xs border-2 border-dashed border-accent-ai bg-accent-ai-subtle" />
            AI 제안 {pageSuggestionCount}개
          </span>
          <span className="inline-flex items-center gap-2xs">
            <span className="h-3 w-3 rounded-xs border-2 border-primary bg-primary-subtle" />
            확정됨 {pageFieldCount}개
          </span>
        </div>
      ) : null}

      {/* Page nav — only when the document has more than one page. */}
      {total > 1 ? (
        <div className="flex items-center justify-center gap-sm rounded-md border border-border bg-surface px-sm py-2xs">
          <TouchIconButton
            label="이전 페이지"
            disabled={page <= 1}
            onClick={() => {
              setSelection(null);
              setPage((p) => Math.max(1, p - 1));
            }}
          >
            <ChevronIcon dir="left" />
          </TouchIconButton>
          <span className="min-w-[88px] text-center text-sm font-medium text-foreground tabular-nums">
            {page} / {total} 페이지
          </span>
          <TouchIconButton
            label="다음 페이지"
            disabled={page >= total}
            onClick={() => {
              setSelection(null);
              setPage((p) => Math.min(total, p + 1));
            }}
          >
            <ChevronIcon dir="right" />
          </TouchIconButton>
        </div>
      ) : null}

      <ReviewCanvas
        file={file}
        page={page}
        fields={fields}
        suggestions={suggestions}
        selection={selection}
        onSelect={setSelection}
        onCommitFieldRect={commitFieldRect}
        onPageCount={setPageCount}
      />

      {/* Contextual touch controls for the selected box. Reserved space (min-h)
          keeps the layout from jumping as selection changes. */}
      <div className="min-h-[132px]">
        {selectedSuggestion ? (
          <SuggestionControls
            type={selectedSuggestion.type}
            onAccept={acceptSelected}
            onDismiss={dismissSelected}
          />
        ) : selectedField ? (
          <FieldControls
            type={selectedField.type}
            onNudge={nudge}
            onGrow={() => resize(GROW)}
            onShrink={() => resize(SHRINK)}
            onDelete={deleteSelectedField}
          />
        ) : (
          <EmptyControlsHint
            hasItems={pageFieldCount > 0 || pageSuggestionCount > 0}
            fieldCount={fields.length}
          />
        )}
      </div>
    </div>
  );
}

// --- Page preview + box overlay (read-only render, tap to select) ------------

interface ReviewCanvasProps {
  file: File;
  page: number;
  fields: SignFieldDraft[];
  suggestions: SignFieldSuggestion[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Commit a settled drag / resize / pinch gesture on one confirmed field. */
  onCommitFieldRect: (id: string, rect: NormRect) => void;
  onPageCount: (count: number) => void;
}

type RenderStatus = 'loading' | 'ready' | 'error';

/**
 * Active touch gesture on a confirmed field (px space, current page). `move` and
 * `resize` are single-pointer; `pinch` tracks two fingers to scale around the
 * box center. Live preview is kept local so dragging re-renders cheaply and the
 * field model is only written on commit (pointer up).
 */
type Gesture =
  | { kind: 'move'; id: string; pointerId: number; startRect: PxRect; startX: number; startY: number; active: boolean }
  | {
      kind: 'resize';
      id: string;
      pointerId: number;
      handle: ResizeHandle;
      startRect: PxRect;
      startX: number;
      startY: number;
    }
  | { kind: 'pinch'; id: string; startRect: PxRect; startDist: number };

/**
 * Renders the current page into a raster <canvas> and lays an interactive overlay
 * of suggestion + field boxes on top, sized from the normalized model via
 * `normToPx` (so boxes track the page exactly like the desktop canvas).
 *
 * Confirmed fields support DIRECT MANIPULATION on touch: drag the body to move,
 * drag a corner/edge handle to resize, or pinch to scale — all with pointer
 * capture, live preview, snap guides, a live %-readout, and page-edge clamping
 * via the shared geometry helpers. Suggestions stay tap-only (confirm/discard).
 */
function ReviewCanvas({
  file,
  page,
  fields,
  suggestions,
  selection,
  onSelect,
  onCommitFieldRect,
  onPageCount,
}: ReviewCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const docRef = React.useRef<PdfDocument | null>(null);

  const [status, setStatus] = React.useState<RenderStatus>('loading');
  const [docReady, setDocReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [width, setWidth] = React.useState(320);
  const [pageSize, setPageSize] = React.useState<PageSize>({ width: 320, height: 320 * 1.414 });

  const onPageCountRef = React.useRef(onPageCount);
  React.useEffect(() => {
    onPageCountRef.current = onPageCount;
  }, [onPageCount]);

  // Track the available width so the page re-fits on rotate / resize.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Open the document once; dispose on unmount.
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

  // Render the current page whenever it, the fit width, or the document changes.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const doc = docRef.current;
    if (!canvas || !docReady || !doc) return;
    let cancelled = false;

    const run = async () => {
      setStatus('loading');
      try {
        const { cssWidth: w, cssHeight: h } = await renderPageToCanvas(doc, page, canvas, width);
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
  }, [docReady, page, width]);

  const pageFields = fields.filter((f) => f.page === page);
  const pageSuggestions = suggestions.filter((s) => s.page === page);

  // --- direct manipulation (drag move / handle resize / pinch) ---------------
  // Live gesture rect + guides + readout are local so a drag never re-renders
  // the parent wizard tree; the field model is written only on commit.
  const gestureRef = React.useRef<Gesture | null>(null);
  const pointersRef = React.useRef<Map<number, { x: number; y: number }>>(new Map());
  const [liveRect, setLiveRect] = React.useState<{ id: string; rect: PxRect } | null>(null);
  const [guides, setGuides] = React.useState<SnapLine[]>([]);
  const [readout, setReadout] = React.useState<string | null>(null);

  const fieldsRef = React.useRef(pageFields);
  fieldsRef.current = pageFields;
  const pageSizeRef = React.useRef(pageSize);
  pageSizeRef.current = pageSize;

  const peerRects = React.useCallback(
    (excludeId: string): PxRect[] =>
      fieldsRef.current.filter((f) => f.id !== excludeId).map((f) => normToPx(f, pageSizeRef.current)),
    [],
  );

  const displayedRect = React.useCallback(
    (field: SignFieldDraft): PxRect =>
      liveRect && liveRect.id === field.id ? liveRect.rect : normToPx(field, pageSize),
    [liveRect, pageSize],
  );

  const startMove = React.useCallback(
    (event: React.PointerEvent, field: SignFieldDraft) => {
      event.stopPropagation();
      onSelect({ kind: 'field', id: field.id });
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);

      const current = displayedRect(field);
      // Second finger on the body → switch to a pinch (scale around center).
      if (pointersRef.current.size >= 2) {
        gestureRef.current = {
          kind: 'pinch',
          id: field.id,
          startRect: current,
          startDist: pointerDistance(pointersRef.current) || 1,
        };
        setLiveRect({ id: field.id, rect: current });
        setReadout(pctSize(current, pageSizeRef.current));
        return;
      }
      gestureRef.current = {
        kind: 'move',
        id: field.id,
        pointerId: event.pointerId,
        startRect: current,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
      setLiveRect({ id: field.id, rect: current });
    },
    [onSelect, displayedRect],
  );

  const startResize = React.useCallback(
    (event: React.PointerEvent, field: SignFieldDraft, handle: ResizeHandle) => {
      event.stopPropagation();
      onSelect({ kind: 'field', id: field.id });
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      const startRect = displayedRect(field);
      gestureRef.current = {
        kind: 'resize',
        id: field.id,
        pointerId: event.pointerId,
        handle,
        startRect,
        startX: event.clientX,
        startY: event.clientY,
      };
      setLiveRect({ id: field.id, rect: startRect });
      setReadout(pctSize(startRect, pageSizeRef.current));
    },
    [onSelect, displayedRect],
  );

  const onGesturePointerMove = React.useCallback((event: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const page = pageSizeRef.current;

    if (g.kind === 'pinch') {
      if (pointersRef.current.size < 2) return;
      const scale = (pointerDistance(pointersRef.current) || g.startDist) / g.startDist;
      const cx = g.startRect.left + g.startRect.width / 2;
      const cy = g.startRect.top + g.startRect.height / 2;
      const width = g.startRect.width * scale;
      const height = g.startRect.height * scale;
      const next = clampPxRect({ left: cx - width / 2, top: cy - height / 2, width, height }, page);
      setLiveRect({ id: g.id, rect: next });
      setReadout(pctSize(next, page));
      return;
    }

    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;

    if (g.kind === 'move') {
      // Stay a tap until the finger crosses the activation threshold.
      if (!g.active && Math.hypot(dx, dy) < DRAG_ACTIVATE_PX) return;
      g.active = true;
      const moved = clampPxRect({ ...g.startRect, left: g.startRect.left + dx, top: g.startRect.top + dy }, page);
      const snapped = snapMove(moved, page, peerRects(g.id), SNAP_THRESHOLD);
      const final = clampPxRect(snapped.rect, page);
      setGuides(snapped.guides);
      setLiveRect({ id: g.id, rect: final });
      setReadout(pctMove(final, page));
      return;
    }

    // resize
    const raw = isCornerHandle(g.handle)
      ? resizeProportionalPx(g.startRect, g.handle, dx, dy)
      : resizePxRect(g.startRect, g.handle, dx, dy);
    const next = clampPxRect(raw, page);
    setLiveRect({ id: g.id, rect: next });
    setReadout(pctSize(next, page));
  }, [peerRects]);

  const endGesture = React.useCallback(
    (event: React.PointerEvent) => {
      const g = gestureRef.current;
      pointersRef.current.delete(event.pointerId);
      try {
        (event.target as Element).releasePointerCapture?.(event.pointerId);
      } catch {
        /* capture may already be gone */
      }
      if (!g) return;
      // A pinch keeps going while ≥2 fingers remain down.
      if (g.kind === 'pinch' && pointersRef.current.size >= 2) return;

      const live = liveRect;
      gestureRef.current = null;
      pointersRef.current.clear();
      setGuides([]);
      setLiveRect(null);
      setReadout(null);
      // A move that never activated was a tap → selection already happened, no
      // geometry write. Everything else commits the previewed rect.
      const wasTap = g.kind === 'move' && !g.active;
      if (!wasTap && live && live.id === g.id) {
        onCommitFieldRect(g.id, clampNormRect(pxToNorm(live.rect, pageSizeRef.current)));
      }
    },
    [liveRect, onCommitFieldRect],
  );

  return (
    <div className="rounded-lg border border-border bg-surface-muted p-sm">
      <div ref={containerRef} className="w-full">
        <div className="relative mx-auto" style={{ width: pageSize.width, height: pageSize.height }}>
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

          {/* Interactive overlay — a tap on empty page clears the selection. */}
          <div className="absolute inset-0" onPointerDown={() => onSelect(null)}>
            {/* Snap guides — drawn while a drag engages a page/peer alignment. */}
            {guides.map((g, i) =>
              g.axis === 'x' ? (
                <span
                  key={`gx-${i}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0 top-0 w-px bg-primary/70"
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
              const rect = displayedRect(field);
              return (
                <FieldBox
                  key={field.id}
                  rect={rect}
                  type={field.type}
                  selected={selection?.kind === 'field' && selection.id === field.id}
                  dragging={liveRect?.id === field.id}
                  onSelect={() => onSelect({ kind: 'field', id: field.id })}
                  onPointerDownBody={(e) => startMove(e, field)}
                  onPointerDownHandle={(e, h) => startResize(e, field, h)}
                  onPointerMove={onGesturePointerMove}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                />
              );
            })}

            {/* Suggestions render above fields so a proposal is never hidden. */}
            {pageSuggestions.map((suggestion) => (
              <SuggestionBox
                key={suggestion.id}
                rect={normToPx(suggestion, pageSize)}
                type={suggestion.type}
                selected={selection?.kind === 'suggestion' && selection.id === suggestion.id}
                onSelect={() => onSelect({ kind: 'suggestion', id: suggestion.id })}
              />
            ))}

            {/* Live feedback — move %/size % during a gesture, announced politely.
                Pinned to the page top so a finger never covers it. */}
            {readout && liveRect ? (
              <div
                role="status"
                aria-live="polite"
                className={cn(
                  'pointer-events-none absolute left-1/2 top-2xs -translate-x-1/2 animate-fade-in',
                  'rounded-full bg-foreground/90 px-sm py-2xs text-2xs font-semibold text-surface shadow-md tabular-nums',
                )}
              >
                {readout}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Shared geometry for a tap-target box: an invisible `::before` extends the hit
 * area to ~44px tall even for short fields (e.g. 날짜), without distorting the
 * true-size visual border the sender reads as the field's real footprint.
 */
const TAP_BOX = cn(
  'group absolute flex select-none items-center justify-center rounded-sm border-2 text-xs font-semibold',
  'outline-none transition-[box-shadow,background-color,border-color] duration-fast ease-standard',
  "before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-['']",
);

/** Touch resize handle: a 24px dot whose invisible `::before` widens the hit
 *  area to ~44px (touch-handle-size + touch-target-min, sizing Token Group). */
const TOUCH_HANDLE = cn(
  'absolute h-6 w-6 rounded-full border-2 border-primary bg-surface shadow-sm touch-none',
  "before:absolute before:-inset-2.5 before:content-['']",
);

/** Centre each handle on its edge/corner (−12px = half the 24px dot). */
const TOUCH_HANDLE_POSITION: Record<ResizeHandle, string> = {
  nw: '-left-3 -top-3',
  n: 'left-1/2 -top-3 -translate-x-1/2',
  ne: '-right-3 -top-3',
  e: '-right-3 top-1/2 -translate-y-1/2',
  se: '-right-3 -bottom-3',
  s: 'left-1/2 -bottom-3 -translate-x-1/2',
  sw: '-left-3 -bottom-3',
  w: '-left-3 top-1/2 -translate-y-1/2',
};

interface FieldBoxProps {
  rect: PxRect;
  type: SignFieldDraft['type'];
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onPointerDownBody: (e: React.PointerEvent) => void;
  onPointerDownHandle: (e: React.PointerEvent, handle: ResizeHandle) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

/**
 * A confirmed field box on the touch review surface. Unlike the suggestion box
 * (tap-only), this is directly manipulable: press-and-drag the body to move,
 * drag a handle to resize, pinch to scale. A plain tap just selects it (the move
 * gesture stays inert until the finger crosses the activation threshold).
 */
function FieldBox({
  rect,
  type,
  selected,
  dragging,
  onSelect,
  onPointerDownBody,
  onPointerDownHandle,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: FieldBoxProps) {
  const meta = FIELD_TYPE_META[type];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`확정된 ${meta.label} 필드. 끌어서 이동, 모서리 핸들이나 두 손가락으로 크기 조절. 아래 컨트롤로 미세 조정 또는 삭제`}
      onPointerDown={onPointerDownBody}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        TAP_BOX,
        'touch-none',
        dragging
          ? 'z-10 scale-[1.02] border-primary bg-primary-subtle/90 text-primary shadow-lg ring-2 ring-focus duration-0'
          : selected
            ? 'border-primary bg-primary-subtle/80 text-primary shadow-md ring-2 ring-focus'
            : 'border-primary/70 bg-primary-subtle/50 text-primary',
      )}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <span className="pointer-events-none flex items-center gap-2xs truncate px-2xs">
        <FieldGlyph type={type} />
        {meta.label}
      </span>

      {/* Resize handles — corners scale proportionally, edges a single axis.
          Shown only when selected; each is a ≥44px touch target. */}
      {selected
        ? RESIZE_HANDLES.map((h) => (
            <span
              key={h}
              aria-hidden="true"
              onPointerDown={(e) => onPointerDownHandle(e, h)}
              className={cn(TOUCH_HANDLE, TOUCH_HANDLE_POSITION[h])}
            />
          ))
        : null}
    </div>
  );
}

function SuggestionBox({
  rect,
  type,
  selected,
  onSelect,
}: {
  rect: PxRect;
  type: SignFieldDraft['type'];
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = FIELD_TYPE_META[type];
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`AI 제안: ${meta.label} 필드. 탭하면 적용 또는 해제`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onSelect}
      className={cn(
        TAP_BOX,
        'animate-ai-suggest-in',
        selected
          ? 'border-accent-ai bg-accent-ai-subtle/80 text-accent-ai shadow-md ring-2 ring-focus-ai'
          : 'border-dashed border-accent-ai/70 bg-accent-ai-subtle/50 text-accent-ai',
      )}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <span className="pointer-events-none flex items-center gap-2xs truncate px-2xs">
        <SparkleGlyph className="h-3 w-3 shrink-0" />
        {meta.label}
      </span>
    </button>
  );
}

// --- Contextual touch controls ----------------------------------------------

function SuggestionControls({
  type,
  onAccept,
  onDismiss,
}: {
  type: SignFieldDraft['type'];
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const meta = FIELD_TYPE_META[type];
  return (
    <div className="flex flex-col gap-sm rounded-lg border border-accent-ai bg-accent-ai-subtle/60 p-md">
      <div className="flex items-center gap-2xs text-sm font-semibold text-accent-ai">
        <SparkleGlyph className="h-4 w-4 shrink-0" />
        AI 제안 · {meta.label}
      </div>
      <div className="flex gap-xs">
        <button
          type="button"
          onClick={onAccept}
          className={cn(
            'flex h-11 flex-1 items-center justify-center gap-2xs rounded-md px-md text-base font-semibold',
            'bg-accent-ai text-accent-ai-foreground shadow-sm transition-colors duration-fast ease-standard',
            'hover:bg-accent-ai-hover active:bg-accent-ai-pressed',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ai active:scale-[0.98]',
          )}
        >
          <CheckIcon />
          적용
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className={cn(
            'flex h-11 items-center justify-center rounded-md border border-border bg-surface px-md text-base font-semibold',
            'text-foreground-muted shadow-xs transition-colors duration-fast ease-standard',
            'hover:bg-grey-100 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus active:scale-[0.98]',
          )}
        >
          해제
        </button>
      </div>
    </div>
  );
}

function FieldControls({
  type,
  onNudge,
  onGrow,
  onShrink,
  onDelete,
}: {
  type: SignFieldDraft['type'];
  onNudge: (dx: number, dy: number) => void;
  onGrow: () => void;
  onShrink: () => void;
  onDelete: () => void;
}) {
  const meta = FIELD_TYPE_META[type];
  return (
    <div className="flex flex-col gap-sm rounded-lg border border-border bg-surface p-md">
      <div className="flex items-center justify-between gap-sm">
        <span className="inline-flex items-center gap-2xs text-sm font-semibold text-primary">
          <FieldGlyph type={type} />
          {meta.label} 미세 조정
        </span>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`${meta.label} 필드 삭제`}
          className={cn(
            'flex h-9 items-center justify-center gap-2xs rounded-md border border-border px-sm text-sm font-semibold',
            'text-danger transition-colors duration-fast ease-standard hover:bg-danger-subtle',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-danger active:scale-[0.98]',
          )}
        >
          <TrashIcon />
          삭제
        </button>
      </div>

      <div className="flex items-center justify-between gap-md">
        {/* Directional nudge pad — y is bottom-left origin, so ↑ raises y. */}
        <div className="grid grid-cols-3 grid-rows-2 gap-2xs">
          <span />
          <NudgeButton label="위로 이동" onClick={() => onNudge(0, MOVE_STEP)}>
            <ArrowIcon dir="up" />
          </NudgeButton>
          <span />
          <NudgeButton label="왼쪽으로 이동" onClick={() => onNudge(-MOVE_STEP, 0)}>
            <ArrowIcon dir="left" />
          </NudgeButton>
          <NudgeButton label="아래로 이동" onClick={() => onNudge(0, -MOVE_STEP)}>
            <ArrowIcon dir="down" />
          </NudgeButton>
          <NudgeButton label="오른쪽으로 이동" onClick={() => onNudge(MOVE_STEP, 0)}>
            <ArrowIcon dir="right" />
          </NudgeButton>
        </div>

        {/* Size stepper. */}
        <div className="flex flex-col items-center gap-2xs">
          <span className="text-2xs font-medium text-foreground-subtle">크기</span>
          <div className="flex items-center gap-2xs">
            <NudgeButton label="크기 줄이기" onClick={onShrink}>
              <MinusIcon />
            </NudgeButton>
            <NudgeButton label="크기 키우기" onClick={onGrow}>
              <PlusIcon />
            </NudgeButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyControlsHint({ hasItems, fieldCount }: { hasItems: boolean; fieldCount: number }) {
  if (fieldCount > 0) {
    return (
      <div className="flex flex-col gap-2xs rounded-lg border border-success/40 bg-success-subtle/60 px-md py-sm">
        <p className="text-sm font-semibold text-foreground">서명란 {fieldCount}개를 확정했어요</p>
        <p className="text-sm text-foreground-muted">
          아래 ‘다음’으로 발송 검토를 이어가거나, 박스를 끌어 옮기고 핸들로 크기를 조정할 수 있어요.
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center rounded-lg border border-dashed border-border-strong bg-surface-muted px-md py-sm">
      <p className="text-sm text-foreground-subtle">
        {hasItems
          ? 'AI 제안을 탭하면 적용되고, 확정한 박스는 끌어서 옮기거나 핸들로 크기를 조정할 수 있어요.'
          : '이 페이지에는 표시할 서명란이 없어요.'}
      </p>
    </div>
  );
}

/** A large (≥44px) touch control used by the nav, nudge pad, and size stepper. */
function NudgeButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface text-foreground-muted',
        'shadow-xs transition-colors duration-fast ease-standard hover:bg-grey-100 hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus active:scale-[0.95]',
      )}
    >
      {children}
    </button>
  );
}

function TouchIconButton({
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
        'flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted',
        'transition-colors duration-fast hover:bg-grey-100 hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}

// --- Glyphs ------------------------------------------------------------------

function ArrowIcon({ dir }: { dir: 'up' | 'down' | 'left' | 'right' }) {
  const rotate = { up: 0, right: 90, down: 180, left: 270 }[dir];
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true" style={{ transform: `rotate(${rotate}deg)` }}>
      <path d="M10 15V5M5 10l5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
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
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M10 5v10M5 10h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M5 10h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M3 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M3 4.5h10M6.5 4.5V3.5h3v1M5 4.5l.5 8h5l.5-8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
