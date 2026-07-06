import * as React from 'react';
import { cn } from '../cn';

/**
 * Confetti — a one-shot particle burst for celebratory moments.
 *
 * Each particle's trajectory is derived deterministically from its index (no
 * Math.random) so server and client markup match — every piece flies out along
 * a fanned angle via the `confetti-burst` keyframe, driven by per-particle
 * `--confetti-*` custom properties. Under reduced-motion the burst does not
 * play (particles stay collapsed at the origin and fade is suppressed).
 *
 * Decorative only — hidden from assistive tech.
 */
export interface ConfettiProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of particles. */
  count?: number;
}

const PARTICLE_COLORS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--brand-primary-subtle)',
];

export const Confetti = React.forwardRef<HTMLDivElement, ConfettiProps>(
  ({ className, count = 28, style, ...props }, ref) => {
    const particles = Array.from({ length: count }, (_, i) => {
      // Fan the particles across a full circle, biased upward, fully derived
      // from the index so the render is stable between SSR and hydration.
      const angle = (i / count) * Math.PI * 2;
      const distance = 90 + ((i * 37) % 70); // 90–160px, pseudo-varied
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance - 40; // upward bias
      const rotate = 180 + ((i * 73) % 360);
      const color = PARTICLE_COLORS[i % PARTICLE_COLORS.length];
      const delay = (i % 6) * 18; // ms
      const round = i % 3 === 0;
      return (
        <span
          key={i}
          className={cn('absolute left-1/2 top-1/2 h-2 w-2 animate-confetti', round ? 'rounded-full' : 'rounded-[1px]')}
          style={{
            backgroundColor: color,
            animationDelay: `${delay}ms`,
            ['--confetti-x' as string]: `${x}px`,
            ['--confetti-y' as string]: `${y}px`,
            ['--confetti-rotate' as string]: `${rotate}deg`,
          }}
        />
      );
    });

    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn('pointer-events-none absolute inset-0 overflow-visible', className)}
        style={style}
        {...props}
      >
        {particles}
      </div>
    );
  },
);
Confetti.displayName = 'Confetti';
