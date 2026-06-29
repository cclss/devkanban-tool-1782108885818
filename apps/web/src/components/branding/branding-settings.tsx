'use client';

/**
 * BrandingSettings — the admin branding configuration surface.
 *
 * Orchestrates the leaf controls (logo uploader, color picker, font dropdown)
 * and the live preview, owning all async state: the initial load, the
 * dirty-tracked color/font save (with success toast + inline error), and the
 * immediate logo upload/removal. Non-Team users never reach the editor — they
 * see a locked upsell with writes disabled, mirroring the server's `forbidden`
 * gate (`canUseBranding`). Auth/entitlement are re-checked server-side on every
 * call; the client gate just avoids a flash and a guaranteed-403 request.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Skeleton, cn } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { clearSession, getToken, getUser, type SessionUser } from '@/lib/auth';
import {
  BRANDING_COPY,
  DEFAULT_BRAND_FONT_KEY,
  canUseBrandingPlan,
  deleteLogo,
  fetchBranding,
  updateBranding,
  uploadLogo,
  type BrandFont,
  type BrandingView,
} from '@/lib/branding';
import { LogoUploader } from './logo-uploader';
import { ColorPicker } from './color-picker';
import { FontSelect } from './font-select';
import { BrandingPreview } from './branding-preview';

type Status = 'loading' | 'locked' | 'ready' | 'error';

const TOAST_MS = 2400;

export function BrandingSettings() {
  const router = useRouter();

  const [status, setStatus] = React.useState<Status>('loading');
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [view, setView] = React.useState<BrandingView | null>(null);

  // Editable draft (color/font are dirty-tracked; logo persists immediately).
  const [color, setColor] = React.useState<string | null>(null);
  const [font, setFont] = React.useState<string>(DEFAULT_BRAND_FONT_KEY);
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null);

  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const fonts: readonly BrandFont[] = view?.fonts ?? [];

  const baselineColor = view?.brandColor ?? null;
  const baselineFont = view?.brandFont ?? DEFAULT_BRAND_FONT_KEY;
  const dirty = color !== baselineColor || font !== baselineFont;

  const showToast = React.useCallback((message: string) => setToast(message), []);

  React.useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  /** Map an error to a side effect (redirect / lock) or an inline message. */
  const handleError = React.useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          clearSession();
          router.replace('/login');
          return;
        }
        if (err.status === 403) {
          setStatus('locked');
          return;
        }
        setError(err.message);
        return;
      }
      setError(BRANDING_COPY.saveError);
    },
    [router],
  );

  const syncFromView = React.useCallback((v: BrandingView) => {
    setView(v);
    setColor(v.brandColor);
    setFont(v.brandFont);
    setLogoUrl(v.brandLogoUrl);
  }, []);

  const load = React.useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const v = await fetchBranding();
      syncFromView(v);
      setStatus(v.entitlement.canUseBranding ? 'ready' : 'locked');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        router.replace('/login');
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setStatus('locked');
        return;
      }
      setStatus('error');
    }
  }, [router, syncFromView]);

  // Auth + plan gate, then load.
  React.useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    const u = getUser();
    setUser(u);
    if (!canUseBrandingPlan(u?.plan)) {
      setStatus('locked');
      return;
    }
    void load();
  }, [router, load]);

  const onSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    const payload: { brandColor?: string; brandFont?: string } = {};
    if (color && color !== baselineColor) payload.brandColor = color;
    if (font !== baselineFont) payload.brandFont = font;
    try {
      const v = await updateBranding(payload);
      // Baseline updates to the saved values, clearing the dirty state.
      setView(v);
      setColor(v.brandColor);
      setFont(v.brandFont);
      showToast(BRANDING_COPY.saved);
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const onSelectLogo = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const v = await uploadLogo(file);
      setView(v);
      setLogoUrl(v.brandLogoUrl);
      showToast(BRANDING_COPY.saved);
    } catch (err) {
      handleError(err);
    } finally {
      setUploading(false);
    }
  };

  const onRemoveLogo = async () => {
    setError(null);
    try {
      const v = await deleteLogo();
      setView(v);
      setLogoUrl(v.brandLogoUrl);
    } catch (err) {
      handleError(err);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <SettingsHeader onBack={() => router.push('/dashboard')} />

      <main className="mx-auto w-full max-w-[960px] px-md py-xl sm:py-2xl">
        <div className="flex flex-col gap-2xs">
          <h1 className="text-2xl font-bold text-foreground">{BRANDING_COPY.title}</h1>
          <p className="text-base text-foreground-subtle">{BRANDING_COPY.subtitle}</p>
        </div>

        <div className="mt-xl">
          {status === 'loading' ? <LoadingState /> : null}
          {status === 'error' ? <ErrorState onRetry={() => void load()} /> : null}
          {status === 'locked' ? (
            <LockedUpsell onUpgrade={() => router.push('/dashboard')} />
          ) : null}
          {status === 'ready' ? (
            <Editor
              senderName={user?.name ?? null}
              color={color}
              font={font}
              fonts={fonts}
              logoUrl={logoUrl}
              uploading={uploading}
              saving={saving}
              dirty={dirty}
              error={error}
              onColorChange={setColor}
              onFontChange={setFont}
              onSelectLogo={onSelectLogo}
              onRemoveLogo={onRemoveLogo}
              onSave={() => void onSave()}
            />
          ) : null}
        </div>
      </main>

      <Toast message={toast} />
    </div>
  );
}

// --- editor -----------------------------------------------------------------

function Editor({
  senderName,
  color,
  font,
  fonts,
  logoUrl,
  uploading,
  saving,
  dirty,
  error,
  onColorChange,
  onFontChange,
  onSelectLogo,
  onRemoveLogo,
  onSave,
}: {
  senderName: string | null;
  color: string | null;
  font: string;
  fonts: readonly BrandFont[];
  logoUrl: string | null;
  uploading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  onColorChange: (hex: string) => void;
  onFontChange: (key: string) => void;
  onSelectLogo: (file: File) => void;
  onRemoveLogo: () => void;
  onSave: () => void;
}) {
  return (
    <div className="motion-stagger grid grid-cols-1 gap-lg lg:grid-cols-2">
      {/* Controls */}
      <Card className="flex flex-col gap-lg p-lg">
        <LogoUploader
          value={logoUrl}
          uploading={uploading}
          onSelect={onSelectLogo}
          onRemove={onRemoveLogo}
        />
        <ColorPicker value={color} onChange={onColorChange} />
        <FontSelect value={font} onChange={onFontChange} fonts={fonts} />

        <div className="flex flex-col gap-xs border-t border-border pt-lg">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end">
            <Button
              type="button"
              size="md"
              onClick={onSave}
              disabled={!dirty || saving}
              isLoading={saving}
            >
              {saving ? BRANDING_COPY.saving : BRANDING_COPY.save}
            </Button>
          </div>
        </div>
      </Card>

      {/* Live preview */}
      <div className="lg:sticky lg:top-[88px] lg:self-start">
        <BrandingPreview
          brandColor={color}
          brandFont={font}
          logoUrl={logoUrl}
          senderName={senderName}
        />
      </div>
    </div>
  );
}

// --- states -----------------------------------------------------------------

function LoadingState() {
  return (
    <div className="grid grid-cols-1 gap-lg lg:grid-cols-2" aria-hidden="true">
      <Card className="flex flex-col gap-lg p-lg">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <div className="flex justify-end">
          <Skeleton className="h-11 w-24" />
        </div>
      </Card>
      <Card className="flex flex-col gap-md p-lg">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-48 w-full" />
      </Card>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-md px-lg py-3xl text-center">
      <p className="text-base text-foreground-muted">{BRANDING_COPY.loadError}</p>
      <Button variant="secondary" onClick={onRetry}>
        {BRANDING_COPY.retry}
      </Button>
    </Card>
  );
}

function LockedUpsell({ onUpgrade }: { onUpgrade: () => void }) {
  const L = BRANDING_COPY.locked;
  return (
    <Card className="motion-stagger flex flex-col items-center gap-md px-lg py-3xl text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-subtle text-primary">
        <LockIcon />
      </span>
      <span className="rounded-full bg-grey-100 px-sm py-2xs text-2xs font-semibold text-foreground-subtle">
        {L.badge}
      </span>
      <div className="flex max-w-[420px] flex-col gap-2xs">
        <h2 className="text-lg font-bold text-foreground">{L.title}</h2>
        <p className="text-base text-foreground-subtle">{L.body}</p>
      </div>
      <Button size="lg" onClick={onUpgrade}>
        {L.cta}
      </Button>
    </Card>
  );
}

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-xl z-50 flex justify-center px-md"
      role="status"
      aria-live="polite"
    >
      <div className="animate-fade-in-up flex items-center gap-xs rounded-full bg-grey-900 px-lg py-sm text-base font-semibold text-surface shadow-lg">
        <CheckBadge />
        {message}
      </div>
    </div>
  );
}

// --- chrome -----------------------------------------------------------------

function SettingsHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-[960px] items-center gap-xs px-md py-sm">
        <button
          type="button"
          onClick={onBack}
          aria-label="대시보드로 돌아가기"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md text-foreground-muted',
            'transition-colors duration-fast ease-standard hover:bg-grey-100',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
          )}
        >
          <BackIcon />
        </button>
        <span className="text-base font-bold tracking-tight text-primary">전자계약</span>
      </div>
    </header>
  );
}

// --- icons ------------------------------------------------------------------

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckBadge() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-success" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="m8.5 12 2.3 2.3L15.5 9.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
