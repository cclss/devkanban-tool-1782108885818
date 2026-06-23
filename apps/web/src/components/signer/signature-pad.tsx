'use client';

/**
 * SignaturePad — a high-DPI drawing surface that turns pointer/touch input into
 * natural, variable-width ink.
 *
 * The ink width is driven by the pure pressure model in `lib/signature`: each
 * segment's speed is measured from event timestamps, mapped to a width that is
 * inversely proportional to speed (fast flick → thin, slow drag → thick), then
 * low-passed so it eases instead of jittering. Because a single canvas path can
 * only carry one `lineWidth`, every segment is stroked on its own as a quadratic
 * curve through the midpoints of consecutive samples — the standard midpoint
 * technique that yields a smooth, continuous outline.
 *
 * Pointer Events unify mouse/touch/stylus; `touch-action: none` keeps a touch
 * drag from scrolling the sheet. The component is uncontrolled: a parent drives
 * it through the imperative handle (`clear` / `isEmpty` / `toDataURL`) and learns
 * when the first mark lands via `onDirtyChange` (to enable the Apply CTA).
 */

import * as React from 'react';
import { cn } from '@repo/ui';
import {
  distance,
  midpoint,
  smoothWidth,
  speed,
  strokeWidthForSpeed,
  DEFAULT_STROKE_WIDTH,
  type InkPoint,
} from '@/lib/signature';

export interface SignaturePadHandle {
  /** Wipe the canvas and reset to empty. */
  clear: () => void;
  /** True until at least one mark has been drawn. */
  isEmpty: () => boolean;
  /** Trimmed PNG data URL of the ink, or `null` if nothing was drawn. */
  toDataURL: () => string | null;
}

interface SignaturePadProps {
  /** Notifies the parent when emptiness flips (drives the Apply CTA). */
  onDirtyChange?: (hasInk: boolean) => void;
  className?: string;
  'aria-label'?: string;
}

/** Resolve a design-token color (e.g. `--color-foreground`) to a usable string. */
function tokenColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export const SignaturePad = React.forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad({ onDirtyChange, className, ...aria }, ref) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);
    const dprRef = React.useRef(1);

    // Live stroke state (refs, not state — these change per pointer event).
    const drawingRef = React.useRef(false);
    const lastPointRef = React.useRef<InkPoint | null>(null);
    const lastMidRef = React.useRef<{ x: number; y: number } | null>(null);
    const widthRef = React.useRef(DEFAULT_STROKE_WIDTH.maxWidth);
    const inkColorRef = React.useRef('#191f28');

    // Drawn-content bounding box (CSS px) for trimming on export.
    const hasInkRef = React.useRef(false);
    const bboxRef = React.useRef({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

    const setHasInk = React.useCallback(
      (next: boolean) => {
        if (hasInkRef.current === next) return;
        hasInkRef.current = next;
        onDirtyChange?.(next);
      },
      [onDirtyChange],
    );

    // Size the backing store to the element's CSS box × devicePixelRatio so the
    // ink is crisp on retina. Re-runs on resize; clears on resize (acceptable —
    // signing is a single short interaction).
    const setupCanvas = React.useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      dprRef.current = dpr;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      inkColorRef.current = tokenColor('--color-foreground', '#191f28');
      ctx.strokeStyle = inkColorRef.current;
      ctxRef.current = ctx;
    }, []);

    const clearInk = React.useCallback(() => {
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (canvas && ctx) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
      drawingRef.current = false;
      lastPointRef.current = null;
      lastMidRef.current = null;
      widthRef.current = DEFAULT_STROKE_WIDTH.maxWidth;
      bboxRef.current = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      setHasInk(false);
    }, [setHasInk]);

    React.useLayoutEffect(() => {
      setupCanvas();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ro = new ResizeObserver(() => {
        setupCanvas();
        clearInk();
      });
      ro.observe(canvas);
      return () => ro.disconnect();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- setup/clear are stable
    }, []);

    const pointFromEvent = React.useCallback((e: React.PointerEvent<HTMLCanvasElement>): InkPoint => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp };
    }, []);

    const trackBbox = React.useCallback((x: number, y: number, w: number) => {
      const b = bboxRef.current;
      const r = w / 2 + 1;
      b.minX = Math.min(b.minX, x - r);
      b.minY = Math.min(b.minY, y - r);
      b.maxX = Math.max(b.maxX, x + r);
      b.maxY = Math.max(b.maxY, y + r);
    }, []);

    const onPointerDown = React.useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (e.button != null && e.button !== 0) return;
        const ctx = ctxRef.current;
        if (!ctx) return;
        e.preventDefault();
        canvasRef.current?.setPointerCapture(e.pointerId);
        drawingRef.current = true;
        const pt = pointFromEvent(e);
        lastPointRef.current = pt;
        lastMidRef.current = { x: pt.x, y: pt.y };
        widthRef.current = DEFAULT_STROKE_WIDTH.maxWidth;
        // Seed a dot so a tap (no move) still leaves a mark.
        ctx.beginPath();
        ctx.fillStyle = inkColorRef.current;
        ctx.arc(pt.x, pt.y, DEFAULT_STROKE_WIDTH.maxWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        trackBbox(pt.x, pt.y, DEFAULT_STROKE_WIDTH.maxWidth);
        setHasInk(true);
      },
      [pointFromEvent, setHasInk, trackBbox],
    );

    const onPointerMove = React.useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;
        const ctx = ctxRef.current;
        const last = lastPointRef.current;
        const lastMid = lastMidRef.current;
        if (!ctx || !last || !lastMid) return;
        e.preventDefault();

        // Coalesced events give smoother, denser sampling on capable browsers.
        const events =
          typeof e.nativeEvent.getCoalescedEvents === 'function'
            ? e.nativeEvent.getCoalescedEvents()
            : [e.nativeEvent];

        let prev = last;
        let prevMid = lastMid;
        for (const raw of events.length ? events : [e.nativeEvent]) {
          const rect = canvasRef.current!.getBoundingClientRect();
          const pt: InkPoint = { x: raw.clientX - rect.left, y: raw.clientY - rect.top, t: raw.timeStamp };
          if (distance(prev, pt) < 0.01) continue;
          const target = strokeWidthForSpeed(speed(prev, pt));
          const w = smoothWidth(widthRef.current, target);
          widthRef.current = w;
          const mid = midpoint(prev, pt);
          ctx.beginPath();
          ctx.lineWidth = w;
          ctx.moveTo(prevMid.x, prevMid.y);
          ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
          ctx.stroke();
          trackBbox(prev.x, prev.y, w);
          trackBbox(mid.x, mid.y, w);
          prev = pt;
          prevMid = mid;
        }
        lastPointRef.current = prev;
        lastMidRef.current = prevMid;
      },
      [trackBbox],
    );

    const endStroke = React.useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      lastPointRef.current = null;
      lastMidRef.current = null;
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // capture may already be gone (e.g. pointercancel) — nothing to do.
      }
    }, []);

    React.useImperativeHandle(
      ref,
      (): SignaturePadHandle => ({
        clear: clearInk,
        isEmpty: () => !hasInkRef.current,
        toDataURL: () => {
          const canvas = canvasRef.current;
          if (!canvas || !hasInkRef.current) return null;
          const dpr = dprRef.current;
          const b = bboxRef.current;
          const pad = 8;
          const x0 = Math.max(0, Math.floor((b.minX - pad) * dpr));
          const y0 = Math.max(0, Math.floor((b.minY - pad) * dpr));
          const x1 = Math.min(canvas.width, Math.ceil((b.maxX + pad) * dpr));
          const y1 = Math.min(canvas.height, Math.ceil((b.maxY + pad) * dpr));
          const w = Math.max(1, x1 - x0);
          const h = Math.max(1, y1 - y0);
          const out = document.createElement('canvas');
          out.width = w;
          out.height = h;
          const octx = out.getContext('2d');
          if (!octx) return canvas.toDataURL('image/png');
          octx.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
          return out.toDataURL('image/png');
        },
      }),
      [clearInk],
    );

    return (
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
        aria-label={aria['aria-label'] ?? '서명 그리기 영역'}
        role="img"
        className={cn(
          'block h-44 w-full touch-none rounded-md border border-border bg-surface',
          'cursor-crosshair select-none',
          className,
        )}
      />
    );
  },
);
