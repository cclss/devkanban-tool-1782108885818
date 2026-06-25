import * as React from 'react';
import { cn } from '../cn';

/**
 * SuccessCheck — an animated success mark for completion moments
 * (e.g. "계약 발송이 완료되었습니다!").
 *
 * The ring and tick are SVG strokes drawn on with the `checkmark-draw` keyframe
 * (stroke-dashoffset → 0). Under reduced-motion the strokes render fully drawn
 * with no animation.
 */
export interface SuccessCheckProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Pixel size of the mark. */
  size?: number;
}

export const SuccessCheck = React.forwardRef<HTMLSpanElement, SuccessCheckProps>(
  ({ className, size = 96, ...props }, ref) => (
    <span
      ref={ref}
      role="img"
      aria-label="완료"
      className={cn('inline-flex', className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <svg viewBox="0 0 80 80" fill="none" className="h-full w-full">
        <circle
          cx="40"
          cy="40"
          r="37"
          stroke="var(--color-success)"
          strokeWidth="5"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100"
          className="animate-checkmark"
          style={{ ['--draw-length' as string]: '100' }}
        />
        <path
          d="M25 41.5 36 52.5 56 30"
          stroke="var(--color-success)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
          strokeDasharray="100"
          className="animate-checkmark"
          style={{ ['--draw-length' as string]: '100', animationDelay: '0.25s' }}
        />
      </svg>
    </span>
  ),
);
SuccessCheck.displayName = 'SuccessCheck';
