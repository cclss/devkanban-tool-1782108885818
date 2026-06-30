'use client';

/**
 * BrandingPreview — a live preview of the signer screens that re-skins as the
 * admin edits color/font/logo.
 *
 * Rather than hand-duplicating the signer markup (which drifts), this renders the
 * *real* signer chrome inside a phone-shaped device frame: the single-source
 * {@link BrandingHeader} (the signer's sender identity) and the shared `Button`
 * primitive. We build a `SignerSender` from the admin's in-progress values and
 * apply {@link brandScope} exactly as the real surfaces do, so the header and CTA
 * are byte-identical to production and can't drift.
 *
 * The preview spans the whole signing journey: a toggle (a WAI-ARIA tablist)
 * switches between 본인확인(OTP) → 문서 서명 → 완료, each carrying the same
 * `brandScope` so logo/color/font reflect live in every state. State changes
 * cross-fade via the project's `fade-in` entrance (the `out-expressive` easing +
 * `slow` duration tokens); color edits animate through the `transition` tokens.
 * Reduced-motion collapses both to an instant swap (handled globally).
 *
 * Per the grain boundary this only renders signer *chrome* — never a real PDF
 * body — and introduces no new visual tokens (color/spacing/radius/typography/
 * transition + the `--brand-*` hooks only).
 */

import * as React from 'react';
import { Button, SuccessCheck, cn } from '@repo/ui';
import { brandScope } from '@/lib/branding';
import { BrandingHeader } from '@/components/signer/branding-header';
import { BRANDING_COPY, expandHex, type BrandFont } from '@/lib/branding-settings';
import type { SignerSender } from '@/lib/signing';

const PREVIEW = BRANDING_COPY.preview;

/** The three signing-journey states, in order. */
type Stage = 'verify' | 'sign' | 'done';
const STAGES: readonly Stage[] = ['verify', 'sign', 'done'] as const;

export function BrandingPreview({
  color,
  font,
  logoUrl,
  className,
}: {
  /** Current hex text — applied only when it's a valid color. */
  color: string;
  font: BrandFont;
  logoUrl: string | null;
  className?: string;
}) {
  // The exact shape the real signer screens consume. Building it here means the
  // reused BrandingHeader + brandScope behave identically to production.
  const previewSender: SignerSender = {
    name: PREVIEW.senderName,
    brandColor: expandHex(color),
    brandFont: font,
    brandLogoUrl: logoUrl,
  };

  const [stage, setStage] = React.useState<Stage>('verify');
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = React.useId();
  const tabId = (s: Stage) => `${baseId}-tab-${s}`;
  const panelId = `${baseId}-panel`;

  // WAI-ARIA tabs (automatic activation): arrows/Home/End move selection and
  // focus together so the keyboard mirrors the pointer.
  const focusStage = React.useCallback((index: number) => {
    const next = (index + STAGES.length) % STAGES.length;
    setStage(STAGES[next]!);
    tabRefs.current[next]?.focus();
  }, []);

  const onTabKeyDown = React.useCallback(
    (event: React.KeyboardEvent, index: number) => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          focusStage(index + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          focusStage(index - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusStage(0);
          break;
        case 'End':
          event.preventDefault();
          focusStage(STAGES.length - 1);
          break;
        default:
          break;
      }
    },
    [focusStage],
  );

  return (
    <div className={cn('flex flex-col gap-sm', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground-muted">{PREVIEW.label}</span>
        <span className="text-xs text-foreground-subtle">{PREVIEW.note}</span>
      </div>

      {/* Stage toggle — a segmented tablist driving the device-frame state. */}
      <div
        role="tablist"
        aria-label={PREVIEW.stageGroupLabel}
        className="flex gap-2xs rounded-md bg-surface-muted p-2xs"
      >
        {STAGES.map((s, i) => {
          const selected = s === stage;
          return (
            <button
              key={s}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId(s)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => setStage(s)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              className={cn(
                'flex-1 rounded-sm px-sm py-xs text-sm font-semibold',
                'transition-colors duration-fast ease-standard',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
                selected
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-foreground-muted hover:text-foreground',
              )}
            >
              {PREVIEW.stages[s].tab}
            </button>
          );
        })}
      </div>

      {/* Device frame — a phone mock holding the live, re-skinning signer chrome. */}
      <div className="mx-auto w-full max-w-[320px] rounded-2xl border border-border bg-surface-muted p-2xs shadow-md">
        <div aria-hidden="true" className="flex justify-center py-2xs">
          <span className="h-1 w-12 rounded-full bg-border" />
        </div>

        {/* The re-skin scope: brandScope sets the --brand-* + --brand-font hooks
            exactly like every real signer surface, so the chrome inside inherits
            the sender's color + font. transition-colors animates color edits. */}
        <div
          role="tabpanel"
          id={panelId}
          aria-labelledby={tabId(stage)}
          tabIndex={0}
          style={brandScope(previewSender)}
          className={cn(
            'overflow-hidden rounded-xl bg-surface',
            'transition-colors duration-base ease-standard',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
          )}
        >
          {/* Keyed by stage so each switch replays the fade-in entrance — a
              token-timed cross-fade that collapses to an instant swap under
              reduced-motion. */}
          <div key={stage} className="animate-fade-in">
            {stage === 'verify' ? (
              <VerifyStage sender={previewSender} />
            ) : stage === 'sign' ? (
              <SignStage sender={previewSender} />
            ) : (
              <DoneStage />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 본인확인 — mirrors verify-screen: header, title/hint, doc chip, OTP, CTA. */
function VerifyStage({ sender }: { sender: SignerSender }) {
  const copy = PREVIEW.stages.verify;
  return (
    <div className="flex flex-col gap-md p-md">
      <BrandingHeader sender={sender} />

      <div className="flex flex-col gap-2xs">
        <h3 className="text-md font-bold text-foreground">{copy.title}</h3>
        <p className="text-sm text-foreground-subtle">{copy.hint}</p>
      </div>

      <p className="truncate rounded-md bg-surface-muted px-sm py-xs text-xs font-medium text-foreground-muted">
        {PREVIEW.docTitle}
      </p>

      {/* OTP cells — a static representation of the segmented code entry. The
          first cell shows the brand focus ring so color edits read here too. */}
      <div aria-hidden="true" className="flex gap-2xs">
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={cn(
              'flex h-10 flex-1 items-center justify-center rounded-md border text-md font-bold',
              'transition-colors duration-base ease-standard',
              i === 0
                ? 'border-primary text-foreground ring-4 ring-focus'
                : 'border-border text-foreground-subtle',
            )}
          >
            {i === 0 ? '0' : ''}
          </span>
        ))}
      </div>

      <PreviewCta>{copy.cta}</PreviewCta>
    </div>
  );
}

/** 문서 서명 — mirrors document-viewer: header, title/progress, page, CTA. */
function SignStage({ sender }: { sender: SignerSender }) {
  const copy = PREVIEW.stages.sign;
  return (
    <div className="flex flex-col gap-md p-md">
      <BrandingHeader sender={sender} />

      <div className="flex flex-col gap-2xs">
        <h3 className="truncate text-md font-bold text-foreground">{PREVIEW.docTitle}</h3>
        <p className="text-xs text-foreground-subtle">{copy.progress}</p>
      </div>

      {/* Document page placeholder — chrome only, never a real PDF body. A
          brand-colored signature-field affordance mirrors the real overlay. */}
      <div className="relative aspect-[1/1.1] w-full overflow-hidden rounded-sm border border-border bg-surface-muted">
        <div aria-hidden="true" className="flex flex-col gap-2xs p-sm">
          {[ 'w-3/4', 'w-full', 'w-5/6', 'w-2/3', 'w-full', 'w-1/2' ].map((w, i) => (
            <span key={i} className={cn('h-2xs rounded-full bg-border', w)} />
          ))}
        </div>
        <span
          aria-hidden="true"
          className={cn(
            'absolute bottom-sm left-sm flex h-10 w-28 items-center justify-center rounded-sm',
            'border-2 border-primary bg-primary-subtle/40 text-2xs font-bold text-primary',
            'transition-colors duration-base ease-standard',
          )}
        >
          {copy.affordance}
        </span>
      </div>

      <PreviewCta>{copy.cta}</PreviewCta>
    </div>
  );
}

/** 완료 — mirrors completion-screen: the shared SuccessCheck + headline/body. */
function DoneStage() {
  const copy = PREVIEW.stages.done;
  return (
    <div className="flex flex-col items-center gap-md p-lg text-center">
      <SuccessCheck size={72} aria-hidden="true" />
      <div className="flex flex-col gap-2xs">
        <h3 className="text-md font-bold text-foreground">{copy.title}</h3>
        <p className="text-sm text-foreground-subtle">{copy.body}</p>
      </div>
    </div>
  );
}

/**
 * The signer's primary CTA, reusing the shared `Button` so it's byte-identical
 * to production. Non-interactive in the preview (out of tab order, hidden from
 * AT) but kept at full brand strength — not `disabled`, which would dim it.
 */
function PreviewCta({ children }: { children: React.ReactNode }) {
  return (
    <Button size="lg" fullWidth tabIndex={-1} aria-hidden="true">
      {children}
    </Button>
  );
}
