import { Plan } from '@repo/db';
import { BRANDING_PLANS, canUseBranding } from './entitlements';

describe('canUseBranding', () => {
  it('denies branding for FREE and PRO (below Team)', () => {
    expect(canUseBranding(Plan.FREE)).toBe(false);
    expect(canUseBranding(Plan.PRO)).toBe(false);
  });

  it('allows branding for TEAM and ENTERPRISE (Team and above)', () => {
    expect(canUseBranding(Plan.TEAM)).toBe(true);
    expect(canUseBranding(Plan.ENTERPRISE)).toBe(true);
  });

  it('covers every Plan enum member (no unhandled tier)', () => {
    const allowed = (Object.values(Plan) as Plan[]).filter(canUseBranding);
    expect(new Set(allowed)).toEqual(new Set([Plan.TEAM, Plan.ENTERPRISE]));
  });
});

describe('BRANDING_PLANS', () => {
  it('contains exactly TEAM and ENTERPRISE', () => {
    expect([...BRANDING_PLANS].sort()).toEqual([Plan.ENTERPRISE, Plan.TEAM].sort());
  });

  it('matches canUseBranding for the allow-set', () => {
    for (const plan of Object.values(Plan) as Plan[]) {
      expect(canUseBranding(plan)).toBe(BRANDING_PLANS.has(plan));
    }
  });
});
