import * as React from 'react';
import { cn } from '../cn';

/**
 * Skeleton — a shimmering placeholder shown while content loads.
 *
 * The moving highlight uses the `shimmer` keyframe over a token-colored
 * gradient surface (`.skeleton-shimmer`). Under reduced-motion the shimmer
 * freezes into a flat grey block.
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  shape?: 'text' | 'rect' | 'circle';
}

const shapeClass: Record<NonNullable<SkeletonProps['shape']>, string> = {
  text: 'rounded-sm h-4',
  rect: 'rounded-md',
  circle: 'rounded-full aspect-square',
};

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, shape = 'rect', ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn('skeleton-shimmer animate-shimmer', shapeClass[shape], className)}
      {...props}
    />
  ),
);
Skeleton.displayName = 'Skeleton';
