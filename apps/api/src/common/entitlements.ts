import { Plan } from '@repo/db';

/**
 * Central plan-entitlement helpers.
 *
 * Single source of truth for "which subscription plans unlock which features".
 * Controllers/guards/services must import from here rather than hard-coding
 * plan comparisons, so the gating rules stay consistent across the API.
 */

/**
 * Plans allowed to use the sender branding feature (logo / color / font on the
 * signer-facing screen). Per spec this is "Team plan and above" — which for
 * this product means the {@link Plan.TEAM} and {@link Plan.ENTERPRISE} tiers.
 *
 * Note: {@link Plan.PRO} is intentionally excluded. "Team 이상" is interpreted
 * as the team/enterprise track, not a numeric ordering over the enum, so the
 * gate is an explicit allow-set rather than a `>=` comparison.
 */
export const BRANDING_PLANS: ReadonlySet<Plan> = new Set<Plan>([
  Plan.TEAM,
  Plan.ENTERPRISE,
]);

/**
 * Whether a user on the given plan may configure branding.
 *
 * @returns `true` for TEAM / ENTERPRISE; `false` for FREE / PRO.
 */
export function canUseBranding(plan: Plan): boolean {
  return BRANDING_PLANS.has(plan);
}
