'use client';

import { BrandingForm } from '@/components/branding-form';
import { useLocale } from '@/components/locale-provider';
import { brandingCopyFor } from '@/lib/settings-copy';

/**
 * Settings → 브랜딩. Heading + intro, then the branding form that assembles the
 * logo · favicon uploaders and the 대표 색상 picker with a save/cancel action
 * bar. The form loads the current branding on mount and, on save, persists the
 * changes and re-applies them service-wide immediately (header logo · browser-tab
 * favicon · brand color) for every end user.
 */
export default function BrandingSettingsPage() {
  const { locale } = useLocale();
  const copy = brandingCopyFor(locale);
  return (
    <section aria-labelledby="branding-heading" className="flex flex-col gap-lg">
      <div className="flex flex-col gap-2xs">
        <h2 id="branding-heading" className="text-lg font-bold text-foreground">
          {copy.title}
        </h2>
        <p className="text-base text-foreground-subtle">{copy.description}</p>
      </div>

      <BrandingForm />
    </section>
  );
}
