/**
 * Premium trial / upgrade branching (grain-7).
 *
 * Pins the frontend contract the editor rests on: given a tiered-analysis status,
 * which non-intrusive surface shows (invite / upgrade / none), whether the
 * remaining-trial count is shown, and how the raw server status maps down. The
 * network seams degrade to a neutral, no-prompt result while the pipeline is dark.
 */

import {
  resolvePremiumPrompt,
  showsTrialCount,
  parseAnalysisStatus,
  nextAnalysisPollDelay,
  ANALYSIS_POLL,
  NEUTRAL_STATUS,
  type AnalysisStatus,
} from './premium-trial';

const status = (over: Partial<AnalysisStatus> = {}): AnalysisStatus => ({
  ...NEUTRAL_STATUS,
  ...over,
});

describe('resolvePremiumPrompt', () => {
  it('shows nothing for a text PDF the heuristics handled', () => {
    expect(resolvePremiumPrompt(status())).toBeNull();
  });

  it('invites on a scanned doc when free trials remain', () => {
    expect(resolvePremiumPrompt(status({ scannedDocument: true, trialsRemaining: 2 }))).toBe('invite');
  });

  it('invites on a scanned doc for a premium account even with no trials', () => {
    expect(
      resolvePremiumPrompt(status({ scannedDocument: true, premium: true, trialsRemaining: 0 })),
    ).toBe('invite');
  });

  it('offers upgrade when the premium engine is needed but trials are exhausted', () => {
    expect(
      resolvePremiumPrompt(status({ scannedDocument: true, trialsRemaining: 0, upgradeRequired: true })),
    ).toBe('upgrade');
  });

  it('prefers the upgrade path over the invite when both could apply', () => {
    // Defensive: upgradeRequired always wins, so an exhausted account never sees
    // a "try it" invite it cannot accept.
    expect(
      resolvePremiumPrompt(
        status({ scannedDocument: true, trialsRemaining: 1, upgradeRequired: true }),
      ),
    ).toBe('upgrade');
  });

  it('shows nothing once the premium engine has already run', () => {
    expect(
      resolvePremiumPrompt(status({ scannedDocument: true, premiumUsed: true, trialsRemaining: 1 })),
    ).toBeNull();
  });

  it('shows nothing on a scanned doc with no trials left and no upgrade flag', () => {
    // Neither consentable nor flagged for upgrade → fall back to manual placement.
    expect(resolvePremiumPrompt(status({ scannedDocument: true, trialsRemaining: 0 }))).toBeNull();
  });

  it('offers the optional accuracy boost on a text PDF when a trial remains', () => {
    // Base handled it (unlimited) — premium is a non-coercive accuracy booster.
    expect(resolvePremiumPrompt(status({ boostAvailable: true, trialsRemaining: 2 }))).toBe('boost');
  });

  it('offers the accuracy boost on a text PDF for a premium account (trials do not apply)', () => {
    expect(
      resolvePremiumPrompt(status({ boostAvailable: true, premium: true, trialsRemaining: 0 })),
    ).toBe('boost');
  });

  it('shows no boost on a text PDF once trials are gone (no upgrade wall — base stays unlimited)', () => {
    // The key reframe: an exhausted non-premium account on a text PDF just gets the
    // unlimited base placement, never an upgrade prompt.
    expect(resolvePremiumPrompt(status({ boostAvailable: true, trialsRemaining: 0 }))).toBeNull();
  });

  it('prefers the scanned-doc invite over the boost when both flags are set', () => {
    // Defensive: a scanned doc uses the invite path; boostAvailable is only ever
    // true on a text PDF, so this just pins the ordering.
    expect(
      resolvePremiumPrompt(status({ scannedDocument: true, boostAvailable: true, trialsRemaining: 1 })),
    ).toBe('invite');
  });

  it('shows no boost once the premium engine has already run', () => {
    expect(
      resolvePremiumPrompt(status({ boostAvailable: true, premiumUsed: true, trialsRemaining: 1 })),
    ).toBeNull();
  });
});

describe('showsTrialCount', () => {
  it('shows the count on a metered scanned-doc invite', () => {
    expect(showsTrialCount(status({ scannedDocument: true, trialsRemaining: 2 }))).toBe(true);
  });

  it('shows the count after a metered trial run', () => {
    expect(showsTrialCount(status({ premiumUsed: true, trialsRemaining: 1 }))).toBe(true);
  });

  it('never shows the count for a premium account', () => {
    expect(showsTrialCount(status({ scannedDocument: true, premium: true }))).toBe(false);
    expect(showsTrialCount(status({ premiumUsed: true, premium: true }))).toBe(false);
  });

  it('does not show the count on a plain text PDF', () => {
    expect(showsTrialCount(status())).toBe(false);
  });

  it('shows the count on a metered text-PDF accuracy boost', () => {
    expect(showsTrialCount(status({ boostAvailable: true, trialsRemaining: 2 }))).toBe(true);
  });

  it('never shows the count for a premium account on the boost', () => {
    expect(showsTrialCount(status({ boostAvailable: true, premium: true }))).toBe(false);
  });
});

describe('parseAnalysisStatus', () => {
  it('maps a text-PDF happy path to a neutral, no-prompt status', () => {
    const s = parseAnalysisStatus({ visionStage: 'not-needed', isPremium: false, trialsRemaining: 2 });
    expect(s.scannedDocument).toBe(false);
    expect(resolvePremiumPrompt(s)).toBeNull();
  });

  it('reads a blocked scanned doc as the upgrade path', () => {
    const s = parseAnalysisStatus({
      visionStage: 'blocked',
      isPremium: false,
      trialsRemaining: 0,
      upgradeRequired: true,
    });
    expect(s.scannedDocument).toBe(true);
    expect(s.premiumUsed).toBe(false);
    expect(resolvePremiumPrompt(s)).toBe('upgrade');
  });

  it('reads a succeeded stage as already-used (remaining count, no prompt)', () => {
    const s = parseAnalysisStatus({ visionStage: 'succeeded', isPremium: false, trialsRemaining: 1 });
    expect(s.premiumUsed).toBe(true);
    expect(resolvePremiumPrompt(s)).toBeNull();
    expect(showsTrialCount(s)).toBe(true);
  });

  it('reads a text PDF with the boost flag as the optional accuracy boost', () => {
    const s = parseAnalysisStatus({
      visionStage: 'not-needed',
      isPremium: false,
      trialsRemaining: 2,
      boostAvailable: true,
    });
    expect(s.scannedDocument).toBe(false);
    expect(s.boostAvailable).toBe(true);
    expect(resolvePremiumPrompt(s)).toBe('boost');
  });

  it('reads a pending "analyzing" stage as in-progress, not scanned, with no prompt', () => {
    const s = parseAnalysisStatus({ visionStage: 'analyzing', isPremium: false, trialsRemaining: 2 });
    expect(s.analyzing).toBe(true);
    expect(s.failed).toBe(false);
    // Pending is a lifecycle state, not a scanned-doc signal — no premium invite.
    expect(s.scannedDocument).toBe(false);
    expect(resolvePremiumPrompt(s)).toBeNull();
  });

  it('reads a "failed" stage as a terminal failure, distinct from found-nothing', () => {
    const s = parseAnalysisStatus({ visionStage: 'failed', isPremium: false, trialsRemaining: 2 });
    expect(s.failed).toBe(true);
    expect(s.analyzing).toBe(false);
    // Failure is handled by the guidance notice, not a premium banner.
    expect(s.scannedDocument).toBe(false);
    expect(resolvePremiumPrompt(s)).toBeNull();
  });

  it('coerces a missing / malformed status to neutral (dark pipeline safe)', () => {
    expect(parseAnalysisStatus(undefined)).toEqual(NEUTRAL_STATUS);
    expect(parseAnalysisStatus({})).toEqual(NEUTRAL_STATUS);
  });

  it('clamps a negative / non-numeric trial count to zero', () => {
    expect(parseAnalysisStatus({ visionStage: 'blocked', trialsRemaining: -3 }).trialsRemaining).toBe(0);
    expect(
      parseAnalysisStatus({ visionStage: 'blocked', trialsRemaining: 'lots' as unknown }).trialsRemaining,
    ).toBe(0);
  });
});

describe('nextAnalysisPollDelay (bounded polling)', () => {
  it('backs off linearly from the base delay', () => {
    expect(nextAnalysisPollDelay(1)).toBe(ANALYSIS_POLL.baseMs);
    expect(nextAnalysisPollDelay(2)).toBe(ANALYSIS_POLL.baseMs * 2);
  });

  it('caps the delay at the ceiling', () => {
    expect(nextAnalysisPollDelay(999)).toBe(ANALYSIS_POLL.maxMs);
  });

  it('floors the attempt at 1 (never a zero / negative delay)', () => {
    expect(nextAnalysisPollDelay(0)).toBe(ANALYSIS_POLL.baseMs);
    expect(nextAnalysisPollDelay(-5)).toBe(ANALYSIS_POLL.baseMs);
  });

  it('is strictly bounded so polling can never spin forever', () => {
    expect(ANALYSIS_POLL.maxAttempts).toBeGreaterThan(0);
    expect(Number.isFinite(ANALYSIS_POLL.maxAttempts)).toBe(true);
  });
});
