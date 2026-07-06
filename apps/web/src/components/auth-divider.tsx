import * as React from 'react';
import { cn } from '@repo/ui';

/**
 * AuthDivider — the "또는" separator between the email form and the social
 * sign-in area on the auth screens. Two hairline rules flank a centered label,
 * all in design tokens. Purely visual structure, so it's hidden from the a11y
 * tree (the surrounding controls already announce their own purpose).
 */
export function AuthDivider({ label = '또는', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-md', className)} aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      <span className="text-sm font-medium text-foreground-subtle">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
