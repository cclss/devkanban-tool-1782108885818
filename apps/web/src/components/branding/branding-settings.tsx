'use client';

/**
 * BrandingSettings — the admin "커스텀 브랜딩" editor.
 *
 * Loads the sender's current branding, then lets ANY plan set a logo, brand
 * color, and signer-screen font, with a live preview that re-skins as they edit.
 * Color/font persist on Save (`PUT /branding`); the logo persists immediately
 * via its own endpoint. Editing/saving/previewing are never gated — only the
 * actual signer-screen *application* is Team-only. When `brandingEnabled` (from
 * the server) is false, a non-blocking notice explains that settings are saved
 * now and take effect on the signer screen once on Team, plus an upgrade CTA;
 * the preview is reframed as "what it'll look like once applied". Outcomes
 * surface as Toss-tone toasts; the save action is optimistic with a loading
 * state and reverts its baseline on failure.
 *
 * All visual values come from design tokens; no raw colors/spacing/etc.
 */

import * as React from 'react';
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@repo/ui';
import { ApiError } from '@/lib/api';
import {
  BRANDING_COPY,
  DEFAULT_FONT,
  expandHex,
  getBranding,
  isValidHex,
  normalizeHexInput,
  updateBranding,
  type BrandFont,
  type BrandingView,
} from '@/lib/branding-settings';
import { ColorField } from './color-field';
import { FontSelect } from './font-select';
import { LogoUploader } from './logo-uploader';
import { BrandingPreview } from './branding-preview';
import { ToastViewport, useToast } from './toast';

type Status = 'loading' | 'ready' | 'error';

export function BrandingSettings() {
  const { toast, notify, dismiss } = useToast();

  const [status, setStatus] = React.useState<Status>('loading');
  const [view, setView] = React.useState<BrandingView | null>(null);
  const [color, setColor] = React.useState('');
  const [font, setFont] = React.useState<BrandFont>(DEFAULT_FONT);
  const [baseline, setBaseline] = React.useState<{ color: string; font: BrandFont }>({
    color: '',
    font: DEFAULT_FONT,
  });
  const [localLogoPreview, setLocalLogoPreview] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [showColorError, setShowColorError] = React.useState(false);

  const hydrate = React.useCallback((v: BrandingView) => {
    setView(v);
    const nextColor = v.brandColor ?? '';
    const nextFont = v.brandFont ?? DEFAULT_FONT;
    setColor(nextColor);
    setFont(nextFont);
    setBaseline({ color: nextColor, font: nextFont });
  }, []);

  const load = React.useCallback(async () => {
    setStatus('loading');
    try {
      const v = await getBranding();
      hydrate(v);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [hydrate]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // `applied` = branding is live on the signer screen (Team+). It gates ONLY the
  // upsell notice and the preview framing — never editing, saving, or preview.
  const applied = view?.brandingEnabled ?? false;
  const colorValid = color.trim() === '' || isValidHex(color.trim());
  const dirty = color.trim() !== baseline.color.trim() || font !== baseline.font;
  const canSave = dirty && colorValid && !saving;

  const onColorChange = React.useCallback((next: string) => {
    // Tidy toward `#rrggbb` while typing; clearing the field resets to default.
    setColor(next.trim() === '' || next.trim() === '#' ? '' : normalizeHexInput(next));
    setShowColorError(false);
  }, []);

  const onSave = React.useCallback(async () => {
    if (!colorValid) {
      setShowColorError(true);
      notify('error', BRANDING_COPY.color.invalid);
      return;
    }

    const prevBaseline = baseline;
    const nextBaseline = { color: color.trim(), font };
    setBaseline(nextBaseline); // optimistic commit
    setSaving(true);
    try {
      const v = await updateBranding({
        brandColor: color.trim() === '' ? null : expandHex(color.trim()),
        brandFont: font,
      });
      hydrate(v);
      notify('success', BRANDING_COPY.savedToast);
    } catch (err) {
      setBaseline(prevBaseline); // revert so the field stays dirty for retry
      if (err instanceof ApiError && err.status === 400) setShowColorError(true);
      notify('error', err instanceof ApiError ? err.message : BRANDING_COPY.saveErrorToast);
    } finally {
      setSaving(false);
    }
  }, [baseline, color, colorValid, font, hydrate, notify]);

  const previewLogo = localLogoPreview ?? view?.logoUrl ?? null;

  return (
    <>
      <div className="grid grid-cols-1 gap-lg lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        {/* Editor */}
        <Card className="flex flex-col gap-lg p-lg">
          {status === 'loading' ? (
            <EditorSkeleton />
          ) : status === 'error' ? (
            <LoadError onRetry={() => void load()} />
          ) : (
            <>
              {!applied ? <ApplyNotice /> : null}

              <fieldset className="flex flex-col gap-lg border-0 p-0">
                <LogoUploader
                  logoUrl={view?.logoUrl ?? null}
                  onChange={(v) => setView(v)}
                  onLocalPreview={setLocalLogoPreview}
                  notify={notify}
                />
                <ColorField
                  value={color}
                  onChange={onColorChange}
                  onReset={() => {
                    setColor('');
                    setShowColorError(false);
                  }}
                  showError={showColorError}
                />
                <FontSelect value={font} onChange={setFont} />
              </fieldset>

              <div className="flex items-center justify-end gap-sm border-t border-border pt-lg">
                {dirty ? (
                  <span className="text-sm text-foreground-subtle">저장하지 않은 변경이 있어요</span>
                ) : null}
                <Button
                  type="button"
                  size="md"
                  isLoading={saving}
                  disabled={!canSave}
                  onClick={() => void onSave()}
                >
                  {saving ? BRANDING_COPY.saving : BRANDING_COPY.save}
                </Button>
              </div>
            </>
          )}
        </Card>

        {/* Preview — sticky alongside the editor on wide screens. */}
        <div className="lg:sticky lg:top-xl">
          <BrandingPreview color={color} font={font} logoUrl={previewLogo} applied={applied} />
        </div>
      </div>

      <ToastViewport toast={toast} onDismiss={dismiss} />
    </>
  );
}

/**
 * Non-blocking upsell notice, shown when branding isn't applied on the signer
 * screen yet (non-Team). It never disables the form — it only explains that
 * settings are saved now and go live once on Team, and offers an upgrade CTA
 * (opens the same "coming soon" dialog the dashboard uses).
 */
function ApplyNotice() {
  const [upgradeOpen, setUpgradeOpen] = React.useState(false);
  const copy = BRANDING_COPY.notice;

  return (
    <div className="flex flex-col gap-sm rounded-lg border border-primary-subtle bg-primary-subtle/40 p-lg">
      <div className="flex items-center gap-xs">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-subtle text-primary">
          <SparkIcon />
        </span>
        <span className="rounded-full bg-primary-subtle px-xs py-2xs text-2xs font-semibold text-primary">
          {copy.badge}
        </span>
      </div>
      <div className="flex flex-col gap-2xs">
        <h2 className="text-md font-bold text-foreground">{copy.title}</h2>
        <p className="text-sm text-foreground-muted">{copy.body}</p>
      </div>
      <div>
        <Button type="button" variant="primary" size="sm" onClick={() => setUpgradeOpen(true)}>
          {copy.cta}
        </Button>
      </div>

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.dialogTitle}</DialogTitle>
            <DialogDescription>{copy.dialogBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{copy.dialogDismiss}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-md px-lg py-2xl text-center">
      <p className="text-base text-foreground-muted">{BRANDING_COPY.loadError}</p>
      <Button type="button" variant="secondary" onClick={onRetry}>
        {BRANDING_COPY.retry}
      </Button>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-lg" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-xs">
          <Skeleton className="h-4 w-24" />
          <Skeleton shape="rect" className="h-12 w-full" />
        </div>
      ))}
      <div className="flex justify-end">
        <Skeleton shape="rect" className="h-11 w-24" />
      </div>
    </div>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5 8.4 10.1 4 8.5l4.4-1.6L10 2.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" fill="currentColor" />
    </svg>
  );
}
