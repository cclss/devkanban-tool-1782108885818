/**
 * Recipient list logic — pure, DOM-free helpers for the wizard's "받는 분" step.
 *
 * The recipients step lets the sender add/remove/reorder signers and assign each
 * placed field to one of them. Two invariants make the rest of the UI simple:
 *
 *   1. Order *is* the array order. The backend takes an ordered `recipients[]`
 *      and fields reference a signer by 0-based `recipientIndex` (see
 *      `documents.dto.ts`). So reordering or removing a recipient must remap the
 *      indices stored on the fields — done here, not in the component.
 *   2. Fields stay validly assigned at all times. Any field pointing at a missing
 *      or out-of-range recipient is re-pointed at the first one (`autoAssign`),
 *      so "every field has a signer" holds without the user babysitting it.
 *
 * Keeping this pure (no React, no DOM) lets the index math be unit-tested
 * directly — the part most likely to silently corrupt the field↔signer mapping.
 */

import type { RecipientDraft, SignFieldDraft } from '@/components/wizard/wizard-context';
import type { SupportedLocale } from './locale';
import { translateWeb } from './web-translations';

/** Backend caps a single contract at 20 recipients (SendContractDto). */
export const MAX_RECIPIENTS = 20;
/** Backend caps a recipient name at 60 chars (RecipientDto). */
export const MAX_NAME_LENGTH = 60;

/**
 * Pragmatic email shape check. Deliberately permissive — it rejects obvious
 * typos (missing @, spaces, no dot in domain) without trying to fully encode
 * RFC 5322. The server (`@IsEmail`) is the real gate; this is fast inline
 * feedback so the user fixes it before reaching send.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** Canonical form for duplicate detection: trimmed + lower-cased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

let recipientCounter = 0;
/** Stable id for list keys / reorder identity (not persisted). */
export function nextRecipientId(): string {
  recipientCounter += 1;
  return `r${recipientCounter}`;
}

export function createRecipient(): RecipientDraft {
  return { id: nextRecipientId(), email: '', name: '' };
}

/**
 * Display name for a recipient, falling back to a localized order-based label
 * (`받는 분 {n}` / `Recipient {n}`) sourced from the `recipients` catalog.
 */
export function recipientLabel(
  recipient: RecipientDraft,
  index: number,
  locale: SupportedLocale,
): string {
  const name = recipient.name.trim();
  return name.length > 0 ? name : translateWeb(locale, 'recipients.label', { n: index + 1 });
}

export type RecipientFieldKey = 'email';

export interface RecipientError {
  email?: string;
}

/** The validation outcomes, decoupled from any copy so the checker stays pure. */
export type RecipientErrorKind = 'required' | 'invalid' | 'duplicate';

/** Localized email-validation messages, resolved from the `recipients` catalog. */
export interface RecipientMessages {
  emailRequired: string;
  emailInvalid: string;
  emailDuplicate: string;
}

/** The email-validation messages for a locale (source of truth: catalog). */
export function recipientMessages(locale: SupportedLocale): RecipientMessages {
  return {
    emailRequired: translateWeb(locale, 'recipients.emailRequired'),
    emailInvalid: translateWeb(locale, 'recipients.emailInvalid'),
    emailDuplicate: translateWeb(locale, 'recipients.emailDuplicate'),
  };
}

const ERROR_KIND_MESSAGE: Record<RecipientErrorKind, keyof RecipientMessages> = {
  required: 'emailRequired',
  invalid: 'emailInvalid',
  duplicate: 'emailDuplicate',
};

/**
 * Pure, copy-free validation core, keyed by recipient id. Email is required and
 * format-checked; the *second and later* occurrences of a duplicated email are
 * flagged (the first stays clean). Name is optional, so it never errors. Kept
 * locale-independent so `recipientsComplete` needs no copy.
 */
function collectRecipientErrorKinds(
  recipients: RecipientDraft[],
): Record<string, RecipientErrorKind> {
  const errors: Record<string, RecipientErrorKind> = {};
  const seen = new Set<string>();

  for (const r of recipients) {
    const raw = r.email.trim();
    if (raw.length === 0) {
      errors[r.id] = 'required';
      continue;
    }
    if (!isValidEmail(raw)) {
      errors[r.id] = 'invalid';
      continue;
    }
    const key = normalizeEmail(raw);
    if (seen.has(key)) {
      errors[r.id] = 'duplicate';
      continue;
    }
    seen.add(key);
  }

  return errors;
}

/**
 * Per-recipient validation with localized messages, keyed by recipient id. The
 * validation logic lives in {@link collectRecipientErrorKinds}; this layer only
 * maps each error kind to its copy for the given locale.
 */
export function validateRecipients(
  recipients: RecipientDraft[],
  locale: SupportedLocale,
): Record<string, RecipientError> {
  const messages = recipientMessages(locale);
  const errors: Record<string, RecipientError> = {};
  for (const [id, kind] of Object.entries(collectRecipientErrorKinds(recipients))) {
    errors[id] = { email: messages[ERROR_KIND_MESSAGE[kind]] };
  }
  return errors;
}

/** True when there is ≥1 recipient and none has a validation error. */
export function recipientsComplete(recipients: RecipientDraft[]): boolean {
  if (recipients.length === 0) return false;
  return Object.keys(collectRecipientErrorKinds(recipients)).length === 0;
}

/**
 * Remap each field's `recipientIndex` through an old→new lookup. A mapping to
 * `null` means the recipient went away, so the field is left unassigned (then
 * usually re-homed by `autoAssignFields`). Fields with no assignment, or whose
 * index isn't in the map, are returned untouched.
 */
export function remapFieldRecipients(
  fields: SignFieldDraft[],
  oldToNew: Map<number, number | null>,
): SignFieldDraft[] {
  let changed = false;
  const next = fields.map((f) => {
    if (f.recipientIndex === undefined) return f;
    if (!oldToNew.has(f.recipientIndex)) return f;
    const mapped = oldToNew.get(f.recipientIndex) ?? null;
    changed = true;
    if (mapped === null) {
      const { recipientIndex: _drop, ...rest } = f;
      return rest;
    }
    return { ...f, recipientIndex: mapped };
  });
  return changed ? next : fields;
}

/** Move a recipient from one position to another, returning a new array. */
export function moveRecipient(
  recipients: RecipientDraft[],
  from: number,
  to: number,
): RecipientDraft[] {
  if (from === to || from < 0 || to < 0) return recipients;
  if (from >= recipients.length || to >= recipients.length) return recipients;
  const next = recipients.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * Build the old→new index map produced by moving position `from` to `to`.
 * Mirrors `moveRecipient` so fields and recipients reorder in lockstep.
 */
export function moveIndexMap(
  length: number,
  from: number,
  to: number,
): Map<number, number> {
  const order = Array.from({ length }, (_, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved!);
  // order[newPos] = oldIndex  →  invert to oldIndex → newPos
  const map = new Map<number, number>();
  order.forEach((oldIndex, newPos) => map.set(oldIndex, newPos));
  return map;
}

/** Old→new index map produced by removing the recipient at `index`. */
export function removeIndexMap(
  length: number,
  index: number,
): Map<number, number | null> {
  const map = new Map<number, number | null>();
  for (let i = 0; i < length; i += 1) {
    if (i === index) map.set(i, null);
    else map.set(i, i > index ? i - 1 : i);
  }
  return map;
}

/**
 * Clamp every field to a valid signer: anything unassigned or out of range is
 * pointed at the first recipient (index 0). With no recipients, all assignments
 * are cleared. This is what keeps "every field has a signer" true after adds,
 * removals, and reorders without the user doing anything.
 */
export function autoAssignFields(
  fields: SignFieldDraft[],
  recipientCount: number,
): SignFieldDraft[] {
  let changed = false;
  const next = fields.map((f) => {
    if (recipientCount === 0) {
      if (f.recipientIndex === undefined) return f;
      changed = true;
      const { recipientIndex: _drop, ...rest } = f;
      return rest;
    }
    const valid = f.recipientIndex !== undefined && f.recipientIndex < recipientCount;
    if (valid) return f;
    changed = true;
    return { ...f, recipientIndex: 0 };
  });
  return changed ? next : fields;
}
