/**
 * Locale-copy foundation for the `lib/*-copy.ts` catalog layer.
 *
 * The web app keeps its client-authored, user-facing strings in per-surface
 * catalog modules (`lib/*-copy.ts`, `lib/signing.ts`, `lib/completion-download.ts`,
 * …). The established, reviewed pattern for making one bilingual is:
 *
 *   1. Author the Korean catalog once as a `const` literal (`... as const`) so the
 *      *narrow* type captures the exact shape and the base voice stays the single
 *      source of truth.
 *   2. Expose a `xCopyFor(locale: 'ko' | 'en')` accessor that returns the Korean
 *      catalog for `'ko'` and a widened English catalog for `'en'`.
 *
 * `signerCopyFor` / `completionDownloadCopyFor` are the reference implementations.
 * The one piece every such accessor needs — but which was duplicated inline in
 * `signing.ts` as a private `WidenStrings` — is the type that turns the narrow
 * `as const` shape into the *assignable* shape the English branch must satisfy
 * (every `'그리기'` literal becomes `string`, functions keep their signatures).
 * That helper lives here so all catalog modules share one definition.
 *
 * This module is types + a thin factory only — it authors no copy itself, so it
 * never becomes a place strings can hide from the per-surface catalogs.
 */

/**
 * Widen a narrow `as const` copy catalog to its structurally-assignable shape:
 * string literals collapse to `string`, function members keep their exact
 * signature, and nested objects/arrays widen member-by-member. This is what a
 * locale branch (e.g. the English catalog) must be assignable to.
 */
export type WidenCopy<T> = T extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result
  : T extends string
    ? string
    : { [K in keyof T]: WidenCopy<T[K]> };

/**
 * A per-surface copy accessor: given the target locale, return that locale's
 * catalog in the widened shape. `KO` is the narrow `as const` base catalog type.
 */
export type CopyFor<KO> = (locale: SupportedCopyLocale) => WidenCopy<KO>;

/** The two locales every catalog must cover. Mirrors `locale.ts` `SupportedLocale`. */
export type SupportedCopyLocale = 'ko' | 'en';

/**
 * Build a `xCopyFor` accessor from a Korean base catalog and its English
 * counterpart. The English catalog is type-checked against the widened Korean
 * shape, so a missing or misshapen English member is a compile error — this is
 * the standard adopted from `signerCopyFor` / `completionDownloadCopyFor`.
 *
 * The `ko` cast is safe: a narrow `as const` value is always assignable to its
 * own widened shape (TS just cannot prove that for an unconstrained generic).
 */
export function copyForLocale<KO>(ko: KO, en: WidenCopy<KO>): CopyFor<KO> {
  const wideKo = ko as WidenCopy<KO>;
  return (locale) => (locale === 'en' ? en : wideKo);
}

/** A single mismatched key path between two catalogs (dot-joined, e.g. `sheet.apply`). */
export interface CopyKeyMismatch {
  /** Dot-joined path to the leaf/branch that differs. */
  path: string;
  /** `'missing'` → present in `ko` but absent in `en`; `'extra'` → the reverse. */
  reason: 'missing' | 'extra';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural key-parity diff between the Korean and English catalogs of one
 * surface. Recurses into nested objects; treats functions and arrays as opaque
 * leaves (their presence, not their internals, is what parity checks). Returns
 * every path that exists in exactly one of the two catalogs.
 *
 * This is the primitive the ko/en parity gate (unit test / CI) is built on: an
 * empty result means full key parity for that surface.
 */
export function copyKeyDiff(ko: unknown, en: unknown, prefix = ''): CopyKeyMismatch[] {
  if (!isPlainObject(ko) || !isPlainObject(en)) return [];

  const mismatches: CopyKeyMismatch[] = [];
  for (const key of Object.keys(ko)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!(key in en)) {
      mismatches.push({ path, reason: 'missing' });
      continue;
    }
    mismatches.push(...copyKeyDiff(ko[key], en[key], path));
  }
  for (const key of Object.keys(en)) {
    if (!(key in ko)) {
      const path = prefix ? `${prefix}.${key}` : key;
      mismatches.push({ path, reason: 'extra' });
    }
  }
  return mismatches;
}

/** `true` when the Korean and English catalogs of a surface have identical key structure. */
export function hasCopyParity(ko: unknown, en: unknown): boolean {
  return copyKeyDiff(ko, en).length === 0;
}
