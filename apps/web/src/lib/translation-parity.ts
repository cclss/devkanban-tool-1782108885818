/**
 * The single translation-coverage registry.
 *
 * Every user-facing copy surface in the web app is bilingual through one of two
 * mechanisms:
 *
 *   1. The API-UI catalog `WEB_TRANSLATIONS` (auth / dashboard / settings / …),
 *      resolved at runtime with a Korean fallback.
 *   2. The per-surface `lib/*-copy.ts` (and `lib/signing.ts`) modules, each
 *      exposing an `xCopyFor(locale)` accessor plus a `*_COPY_CATALOGS` `{ ko, en }`
 *      pair for gating.
 *
 * A translation is "missing" whenever a key exists in the Korean base but not in
 * the English branch — at runtime it silently renders Korean, which is exactly
 * the bug this project exists to close. This module collects *all* those surfaces
 * into one flat list of `CopyParityTarget`s so a single gate
 * (`assertTranslationParity`) can prove full ko/en key parity across the whole
 * app, and the offline `WEB_TRANSLATIONS` audit can be folded in alongside it.
 *
 * When a new bilingual surface is added, register its `{ ko, en }` catalog here
 * so it is covered by the gate — that is the one manual step the gate depends on.
 */

import { CONTRACT_DETAIL_COPY_CATALOGS } from './contract-detail';
import type { CopyParityTarget } from './copy-locale';
import { NEW_CONTRACT_COPY_CATALOGS } from './new-contract-copy';
import { ONBOARDING_COPY_CATALOGS } from './onboarding-copy';
import { RECIPIENT_COPY_CATALOGS } from './recipients';
import { SETTINGS_COPY_CATALOGS } from './settings-copy';
import { SHARE_COPY_CATALOGS } from './sharing';
import { SIGNER_COPY_CATALOGS } from './signing';
import { TEMPLATES_COPY_CATALOGS } from './templates-copy';
import { TODO_COPY_CATALOGS } from './todo-copy';
import { WEB_TRANSLATIONS } from './web-translations';

type CopyCatalogs = Readonly<Record<string, { ko: unknown; en: unknown }>>;

/** Every per-surface `*_COPY_CATALOGS` module, namespaced by module for gate output. */
const COPY_CATALOG_MODULES: Readonly<Record<string, CopyCatalogs>> = {
  'contract-detail': CONTRACT_DETAIL_COPY_CATALOGS,
  'new-contract': NEW_CONTRACT_COPY_CATALOGS,
  onboarding: ONBOARDING_COPY_CATALOGS,
  recipients: RECIPIENT_COPY_CATALOGS,
  settings: SETTINGS_COPY_CATALOGS,
  sharing: SHARE_COPY_CATALOGS,
  signing: SIGNER_COPY_CATALOGS,
  templates: TEMPLATES_COPY_CATALOGS,
  todo: TODO_COPY_CATALOGS,
};

/**
 * Flatten every registered bilingual surface into one list of ko/en targets for
 * the parity gate. Includes the `WEB_TRANSLATIONS` catalog (compared ko-vs-en as
 * a whole) and every per-surface catalog, each labelled `module.surface`.
 */
export function collectCopyParityTargets(): CopyParityTarget[] {
  const targets: CopyParityTarget[] = [
    { label: 'web-translations', ko: WEB_TRANSLATIONS.ko, en: WEB_TRANSLATIONS.en },
  ];

  for (const [moduleName, catalogs] of Object.entries(COPY_CATALOG_MODULES)) {
    for (const [surface, { ko, en }] of Object.entries(catalogs)) {
      targets.push({ label: `${moduleName}.${surface}`, ko, en });
    }
  }

  return targets;
}
