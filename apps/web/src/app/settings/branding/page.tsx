import { BrandingSettings } from '@/components/branding/branding-settings';

/**
 * `/settings/branding` — the admin branding configuration screen.
 *
 * All behavior (auth/plan gate, load, save, upload) lives in the client
 * component; this route is a thin mount point.
 */
export default function BrandingSettingsPage() {
  return <BrandingSettings />;
}
