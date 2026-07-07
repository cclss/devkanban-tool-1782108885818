import { BrandingForm } from '@/components/branding-form';
import { BRANDING_COPY } from '@/lib/settings-copy';

/**
 * Settings → 브랜딩. Heading + intro, then the branding form that assembles the
 * logo · favicon uploaders and the 대표 색상 picker with a save/cancel action
 * bar. The form loads the current branding on mount and, on save, persists the
 * changes and re-applies them service-wide immediately (header logo · browser-tab
 * favicon · brand color) for every end user.
 */
export default function BrandingSettingsPage() {
  return (
    <section aria-labelledby="branding-heading" className="flex flex-col gap-lg">
      <div className="flex flex-col gap-2xs">
        <h2 id="branding-heading" className="text-lg font-bold text-foreground">
          {BRANDING_COPY.title}
        </h2>
        <p className="text-base text-foreground-subtle">{BRANDING_COPY.description}</p>
      </div>

      <BrandingForm />
    </section>
  );
}
