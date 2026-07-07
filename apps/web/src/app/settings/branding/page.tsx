import * as React from 'react';
import { Card } from '@repo/ui';
import { BRANDING_COPY } from '@/lib/settings-copy';

/**
 * Settings → 브랜딩. The section shell/entry: heading + intro. The actual
 * branding form (로고 · 파비콘 업로더, 대표 색상 컬러 피커) lands in a later grain;
 * for now this renders the selected section with a calm placeholder so entering
 * settings shows a coherent, non-empty 브랜딩 page.
 */
export default function BrandingSettingsPage() {
  return (
    <section aria-labelledby="branding-heading" className="flex flex-col gap-md">
      <div className="flex flex-col gap-2xs">
        <h2 id="branding-heading" className="text-lg font-bold text-foreground">
          {BRANDING_COPY.title}
        </h2>
        <p className="text-base text-foreground-subtle">{BRANDING_COPY.description}</p>
      </div>

      <Card className="px-lg py-2xl text-center">
        <p className="text-sm text-foreground-subtle">{BRANDING_COPY.placeholder}</p>
      </Card>
    </section>
  );
}
