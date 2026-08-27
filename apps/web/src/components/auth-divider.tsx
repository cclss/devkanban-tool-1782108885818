'use client';

import * as React from 'react';
import { cn } from '@repo/ui';
import { useTranslation } from '@/components/locale-provider';

/**
 * AuthDivider — the "or" separator between the email form and the social
 * sign-in area on the auth screens. Two hairline rules flank a centered label,
 * all in design tokens. Purely visual structure, so it's hidden from the a11y
 * tree (the surrounding controls already announce their own purpose).
 *
 * Copy is never owned here: the default label comes from the `auth` translation
 * namespace; callers may still override it with an explicit `label`.
 */
export function AuthDivider({ label, className }: { label?: string; className?: string }) {
  const t = useTranslation();
  return (
    <div className={cn('flex items-center gap-md', className)} aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      <span className="text-sm font-medium text-foreground-subtle">{label ?? t('auth.dividerOr')}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
