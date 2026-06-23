'use client';

/**
 * SignatureInputSheet — the signer's capture surface, a bottom BottomSheet.
 *
 * It targets the field the signer tapped (read from the signer context's
 * `activeFieldId`) and adapts to that field's type:
 *
 *   • SIGNATURE — a segmented toggle picks one of two ways to sign:
 *       ① 그리기 — draw on the high-DPI `SignaturePad` (variable-width pressure
 *         ink + smoothing), with a '다시' reset.
 *       ② 입력 — type a name and pick a handwriting / serif / sans font; the
 *         chosen rendering is rasterized to a PNG so it lands in the same field.
 *   • DATE / TEXT — a lightweight inline input variant (date picker / text box).
 *
 * '적용' captures the value into the signer context (so the page overlay reflects
 * it immediately) and persists it to the grain-1 `fields` endpoint before the
 * sheet closes. The Sheet/Button/Field primitives come from @repo/ui; every
 * visual value is a design token.
 */

import * as React from 'react';
import {
  Button,
  Field,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from '@repo/ui';
import {
  getSignerSession,
  saveFields,
  serializeFieldValue,
  SIGNER_COPY,
  type SignFieldType,
  type SigningPayloadField,
} from '@/lib/signing';
import {
  SIGNATURE_FONTS,
  DEFAULT_SIGNATURE_FONT,
  type SignatureFont,
} from '@/lib/signature';
import { useSigner, type SignerFieldValue } from './signer-context';
import { SignaturePad, type SignaturePadHandle } from './signature-pad';

const COPY = SIGNER_COPY.sheet;

/** Resolve a design-token color (e.g. `--color-foreground`) to a usable string. */
function tokenColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Today as an ISO `YYYY-MM-DD` string in the signer's locale (date input value). */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Rasterize a typed name in the chosen font to a trimmed PNG data URL, so a
 * typed signature lands in the same SIGNATURE field as a drawn one. Waits for
 * the web font to load so the raster matches the on-screen preview.
 */
async function rasterizeTypedName(text: string, fontFamily: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed || typeof document === 'undefined') return null;

  const fontSize = 72;
  try {
    await document.fonts?.load(`${fontSize}px ${fontFamily}`, trimmed);
    await document.fonts?.ready;
  } catch {
    // Font may be unavailable; fall back to whatever the stack resolves to.
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const padding = 20;
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  measure.font = `${fontSize}px ${fontFamily}`;
  const m = measure.measureText(trimmed);
  const ascent = m.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = m.actualBoundingBoxDescent || fontSize * 0.25;
  const w = Math.max(1, Math.ceil(m.width) + padding * 2);
  const h = Math.ceil(ascent + descent) + padding * 2;

  const out = document.createElement('canvas');
  out.width = Math.round(w * dpr);
  out.height = Math.round(h * dpr);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillStyle = tokenColor('--color-foreground', '#191f28');
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(trimmed, padding, padding + ascent);
  return out.toDataURL('image/png');
}

export function SignatureInputSheet() {
  const { token, state, closeField, setFieldValue } = useSigner();
  const { activeFieldId, payload } = state;

  const field = React.useMemo(
    () => payload?.fields.find((f) => f.id === activeFieldId) ?? null,
    [payload, activeFieldId],
  );

  return (
    <Sheet
      open={field != null}
      onOpenChange={(open) => {
        if (!open) closeField();
      }}
    >
      <SheetContent side="bottom">
        {field ? (
          // Key by field id so each capture starts from a fresh, reset state.
          <SheetBody
            key={field.id}
            field={field}
            token={token}
            onCommit={(value) => setFieldValue(field.id, value)}
            onCancel={closeField}
          />
        ) : (
          <SheetTitle className="sr-only">{COPY.title.SIGNATURE}</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface SheetBodyProps {
  field: SigningPayloadField;
  token: string;
  onCommit: (value: SignerFieldValue) => void;
  onCancel: () => void;
}

function SheetBody({ field, token, onCommit, onCancel }: SheetBodyProps) {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Persist to the server, then commit to context (which reflects on the page
  // and closes the sheet). Keeps the sheet open with a message if the save fails.
  const persistAndCommit = React.useCallback(
    async (value: SignerFieldValue) => {
      const serialized = serializeFieldValue(
        value.type === 'SIGNATURE'
          ? { type: 'SIGNATURE', dataUrl: value.dataUrl }
          : { type: value.type, text: value.text },
      );
      if (!serialized) return;
      setError(null);
      setSaving(true);
      try {
        const session = getSignerSession(token);
        if (session) {
          await saveFields(token, session, [{ fieldId: field.id, value: serialized }]);
        }
        onCommit(value);
      } catch {
        setError(COPY.saveError);
      } finally {
        setSaving(false);
      }
    },
    [field.id, token, onCommit],
  );

  const title = COPY.title[field.type];

  return (
    <>
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{hintFor(field.type)}</SheetDescription>
      </SheetHeader>

      {field.type === 'SIGNATURE' ? (
        <SignatureBody saving={saving} onApply={persistAndCommit} onCancel={onCancel} />
      ) : (
        <InlineValueBody
          type={field.type}
          saving={saving}
          onApply={persistAndCommit}
          onCancel={onCancel}
        />
      )}

      {error ? (
        <p className="mt-md text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function hintFor(type: SignFieldType): string {
  if (type === 'DATE') return '서명한 날짜를 입력해 주세요.';
  if (type === 'TEXT') return '필요한 내용을 입력해 주세요.';
  return COPY.drawHint;
}

// --- SIGNATURE: draw / type --------------------------------------------------

type SignMode = 'draw' | 'type';

function SignatureBody({
  saving,
  onApply,
  onCancel,
}: {
  saving: boolean;
  onApply: (value: SignerFieldValue) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = React.useState<SignMode>('draw');
  const [hasInk, setHasInk] = React.useState(false);
  const [name, setName] = React.useState('');
  const [font, setFont] = React.useState<SignatureFont>(DEFAULT_SIGNATURE_FONT);
  const [rasterizing, setRasterizing] = React.useState(false);
  const padRef = React.useRef<SignaturePadHandle>(null);

  const canApply = mode === 'draw' ? hasInk : name.trim().length > 0;
  const busy = saving || rasterizing;

  const apply = React.useCallback(async () => {
    if (mode === 'draw') {
      const dataUrl = padRef.current?.toDataURL();
      if (!dataUrl) return;
      await onApply({ type: 'SIGNATURE', dataUrl });
      return;
    }
    setRasterizing(true);
    try {
      const dataUrl = await rasterizeTypedName(name, font.fontFamily);
      if (!dataUrl) return;
      await onApply({ type: 'SIGNATURE', dataUrl });
    } finally {
      setRasterizing(false);
    }
  }, [mode, name, font, onApply]);

  return (
    <div className="flex flex-col gap-md">
      <ModeToggle mode={mode} onChange={setMode} />

      {mode === 'draw' ? (
        <div className="flex flex-col gap-xs">
          <SignaturePad ref={padRef} onDirtyChange={setHasInk} />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => padRef.current?.clear()}
              disabled={!hasInk}
            >
              {COPY.reset}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-md">
          <div className="flex h-44 items-center justify-center overflow-hidden rounded-md border border-border bg-surface px-md">
            <span
              className={cn('truncate text-3xl leading-none', name ? 'text-foreground' : 'text-foreground-subtle')}
              style={{ fontFamily: font.fontFamily }}
            >
              {name || COPY.typePlaceholder}
            </span>
          </div>
          <Field label={COPY.typeHint} htmlFor="signer-typed-name">
            <Input
              id="signer-typed-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={COPY.typePlaceholder}
              autoComplete="name"
              maxLength={40}
            />
          </Field>
          <FontChips name={name} selected={font} onSelect={setFont} />
        </div>
      )}

      <ApplyRow saving={busy} canApply={canApply} onApply={apply} onCancel={onCancel} />
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: SignMode; onChange: (m: SignMode) => void }) {
  const options: { id: SignMode; label: string }[] = [
    { id: 'draw', label: COPY.modeDraw },
    { id: 'type', label: COPY.modeType },
  ];
  return (
    <div role="tablist" aria-label="서명 입력 방식" className="grid grid-cols-2 gap-2xs rounded-md bg-surface-muted p-2xs">
      {options.map((o) => {
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={cn(
              'h-10 rounded-sm text-sm font-semibold',
              'transition-[background-color,color,box-shadow] duration-fast ease-standard',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
              active ? 'bg-surface text-foreground shadow-xs' : 'text-foreground-subtle',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FontChips({
  name,
  selected,
  onSelect,
}: {
  name: string;
  selected: SignatureFont;
  onSelect: (f: SignatureFont) => void;
}) {
  const preview = name.trim();
  return (
    <div className="flex flex-col gap-xs">
      <span className="text-sm font-semibold text-foreground-muted">{COPY.fontLabel}</span>
      <div role="radiogroup" aria-label={COPY.fontLabel} className="flex gap-xs overflow-x-auto pb-2xs">
        {SIGNATURE_FONTS.map((f) => {
          const active = selected.id === f.id;
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={f.label}
              onClick={() => onSelect(f)}
              style={{ fontFamily: f.fontFamily }}
              className={cn(
                'shrink-0 rounded-md border px-md py-xs text-lg leading-none',
                'transition-[border-color,background-color,color] duration-fast ease-standard',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
                active
                  ? 'border-primary bg-primary-subtle text-primary'
                  : 'border-border text-foreground',
              )}
            >
              {preview || f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- DATE / TEXT: lightweight inline input -----------------------------------

function InlineValueBody({
  type,
  saving,
  onApply,
  onCancel,
}: {
  type: 'DATE' | 'TEXT';
  saving: boolean;
  onApply: (value: SignerFieldValue) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(() => (type === 'DATE' ? todayIso() : ''));
  const canApply = value.trim().length > 0;
  const inputId = `signer-inline-${type.toLowerCase()}`;

  const apply = React.useCallback(() => {
    const v = value.trim();
    if (!v) return;
    return onApply(type === 'DATE' ? { type: 'DATE', text: v } : { type: 'TEXT', text: v });
  }, [type, value, onApply]);

  return (
    <div className="flex flex-col gap-md">
      <Field label={type === 'DATE' ? COPY.dateLabel : COPY.textLabel} htmlFor={inputId}>
        <Input
          id={inputId}
          type={type === 'DATE' ? 'date' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={type === 'TEXT' ? COPY.textPlaceholder : undefined}
          maxLength={type === 'TEXT' ? 200 : undefined}
        />
      </Field>
      <ApplyRow saving={saving} canApply={canApply} onApply={apply} onCancel={onCancel} />
    </div>
  );
}

// --- shared apply row --------------------------------------------------------

function ApplyRow({
  saving,
  canApply,
  onApply,
  onCancel,
}: {
  saving: boolean;
  canApply: boolean;
  onApply: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-xs pt-2xs">
      <Button type="button" variant="secondary" size="lg" onClick={onCancel} disabled={saving}>
        닫기
      </Button>
      <Button
        type="button"
        size="lg"
        fullWidth
        onClick={onApply}
        isLoading={saving}
        disabled={!canApply || saving}
      >
        {COPY.apply}
      </Button>
    </div>
  );
}
