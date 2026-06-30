import { Plan } from '@repo/db';

/**
 * Single source of truth for the "branding" entitlement.
 *
 * Sender branding (brand color, signer-screen font, and — in a later grain —
 * the logo) is a paid feature: it is available from the "Team" tier upward,
 * which the data model represents as {@link Plan.PRO} and {@link Plan.ENTERPRISE}.
 * FREE is below the gate.
 *
 * The threshold lives here and ONLY here — controllers, services, and the
 * `GET /branding` eligibility flag all funnel through this helper so the rule
 * can never drift between call sites. (`plan.spec.ts` asserts there is exactly
 * one threshold definition.)
 */
const BRANDING_PLANS: ReadonlySet<Plan> = new Set([Plan.PRO, Plan.ENTERPRISE]);

/** Whether a plan may configure sender branding. */
export function isBrandingEnabled(plan: Plan | null | undefined): boolean {
  return plan != null && BRANDING_PLANS.has(plan);
}
