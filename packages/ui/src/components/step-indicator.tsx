import * as React from 'react';
import { cn } from '../cn';

/**
 * StepIndicator — horizontal progress through an ordered flow
 * (e.g. upload → place fields → recipients → send).
 *
 * The active step plays the `step-bounce` keyframe (a spring overshoot) each
 * time it becomes current; completed steps show a checkmark; the connector
 * fills as the flow advances. Reduced-motion drops the bounce to a static pop.
 */
export interface StepIndicatorProps extends React.HTMLAttributes<HTMLOListElement> {
  steps: string[];
  /** Zero-based index of the active step. */
  current: number;
}

export const StepIndicator = React.forwardRef<HTMLOListElement, StepIndicatorProps>(
  ({ className, steps, current, ...props }, ref) => (
    <ol
      ref={ref}
      className={cn('flex w-full items-center', className)}
      aria-label="진행 단계"
      {...props}
    >
      {steps.map((label, index) => {
        const status = index < current ? 'complete' : index === current ? 'current' : 'upcoming';
        const isLast = index === steps.length - 1;
        return (
          <li
            key={label}
            className={cn('flex items-center', !isLast && 'flex-1')}
            aria-current={status === 'current' ? 'step' : undefined}
          >
            <div className="flex flex-col items-center gap-2xs">
              <span
                key={`${label}-${status}`}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold',
                  'transition-colors duration-base ease-standard',
                  status === 'complete' && 'bg-primary text-primary-foreground',
                  status === 'current' &&
                    'bg-primary text-primary-foreground ring-4 ring-focus animate-step-bounce',
                  status === 'upcoming' && 'bg-grey-200 text-foreground-subtle',
                )}
              >
                {status === 'complete' ? (
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                    <path
                      d="M5 10.5 8.5 14 15 6.5"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  'text-xs font-medium',
                  status === 'upcoming' ? 'text-foreground-subtle' : 'text-foreground',
                )}
              >
                {label}
              </span>
            </div>
            {!isLast ? (
              <span
                aria-hidden="true"
                className={cn(
                  'mx-xs mb-5 h-0.5 flex-1 rounded-full transition-colors duration-base ease-standard',
                  index < current ? 'bg-primary' : 'bg-grey-200',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  ),
);
StepIndicator.displayName = 'StepIndicator';
