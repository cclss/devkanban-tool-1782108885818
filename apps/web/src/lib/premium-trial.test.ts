/**
 * Premium AI consent branching.
 *
 * Pins the frontend contract the editor rests on: given a tiered-analysis status,
 * which non-intrusive surface shows (invite / boost / none) and how the raw server
 * status maps down. Premium AI is unlimited on every plan (2026-07-06 decision),
 * so there is no trial count and no upgrade wall. The network seams degrade to a
 * neutral, no-prompt result while the pipeline is dark.
 */

import {
  resolvePremiumPrompt,
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

  it('invites (consent) on a scanned doc — premium is unlimited', () => {
    expect(resolvePremiumPrompt(status({ scannedDocument: true }))).toBe('invite');
  });

  it('shows nothing once the premium engine has already run', () => {
    expect(
      resolvePremiumPrompt(status({ scannedDocument: true, premiumUsed: true })),
    ).toBeNull();
  });

  it('offers the optional accuracy boost on a text PDF', () => {
    // Base handled it (unlimited) — premium is a non-coercive accuracy booster.
    expect(resolvePremiumPrompt(status({ boostAvailable: true }))).toBe('boost');
  });

  it('shows no boost once the premium engine has already run', () => {
    expect(
      resolvePremiumPrompt(status({ boostAvailable: true, premiumUsed: true })),
    ).toBeNull();
  });

  it('prefers the scanned-doc invite over the boost when both flags are set', () => {
    // Defensive: a scanned doc uses the invite path; boostAvailable is only ever
    // true on a text PDF, so this just pins the ordering.
    expect(
      resolvePremiumPrompt(status({ scannedDocument: true, boostAvailable: true })),
    ).toBe('invite');
  });
});

describe('parseAnalysisStatus', () => {
  it('maps a text-PDF happy path to a neutral, no-prompt status', () => {
    const s = parseAnalysisStatus({ visionStage: 'not-needed' });
    expect(s.scannedDocument).toBe(false);
    expect(resolvePremiumPrompt(s)).toBeNull();
  });

  it('reads an available scanned doc as the consent invite', () => {
    const s = parseAnalysisStatus({ visionStage: 'available' });
    expect(s.scannedDocument).toBe(true);
    expect(s.premiumUsed).toBe(false);
    expect(resolvePremiumPrompt(s)).toBe('invite');
  });

  it('reads a succeeded stage as already-used (no prompt)', () => {
    const s = parseAnalysisStatus({ visionStage: 'succeeded' });
    expect(s.premiumUsed).toBe(true);
    expect(resolvePremiumPrompt(s)).toBeNull();
  });

  it('reads a text PDF with the boost flag as the optional accuracy boost', () => {
    const s = parseAnalysisStatus({ visionStage: 'not-needed', boostAvailable: true });
    expect(s.scannedDocument).toBe(false);
    expect(s.boostAvailable).toBe(true);
    expect(resolvePremiumPrompt(s)).toBe('boost');
  });

  it('reads a pending "analyzing" stage as in-progress, not scanned, with no prompt', () => {
    const s = parseAnalysisStatus({ visionStage: 'analyzing' });
    expect(s.analyzing).toBe(true);
    expect(s.failed).toBe(false);
    // Pending is a lifecycle state, not a scanned-doc signal — no premium invite.
    expect(s.scannedDocument).toBe(false);
    expect(resolvePremiumPrompt(s)).toBeNull();
  });

  it('reads a "failed" stage as a terminal failure, distinct from found-nothing', () => {
    const s = parseAnalysisStatus({ visionStage: 'failed' });
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
