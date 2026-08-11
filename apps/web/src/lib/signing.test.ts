/**
 * Unit tests for the signer flow's session-expiry decision.
 *
 * The re-auth routing (M-2) hinges on one predicate: "did this call fail because
 * the ~30-minute signer session lapsed?" — i.e. a 401 from a session-guarded
 * endpoint (or the synthesized 401 when no session is stored). The predicate is
 * pure, so we pin its behavior here; the state-machine wiring that consumes it
 * (`signer-context`) is verified by build + manual E2E.
 */

import { ApiError } from './api';
import {
  entryPhaseAfterVerify,
  isSessionExpiredError,
  signProgress,
  visibleClauseCards,
  MAX_CLAUSE_CARDS,
  SIGNER_COPY,
  type ExtractedClause,
} from './signing';

/** Minimal clause factory for the routing/clamp tests. */
function clause(overrides: Partial<ExtractedClause> = {}): ExtractedClause {
  return {
    title: '제1조 (목적)',
    plainText: '이 계약의 목적을 설명해요.',
    figures: [],
    caution: false,
    page: 1,
    ...overrides,
  };
}

describe('isSessionExpiredError', () => {
  it('is true for a 401 ApiError (session lapsed or missing)', () => {
    expect(
      isSessionExpiredError(
        new ApiError('본인확인 후 시간이 지났어요. 인증 코드를 다시 입력해 주세요.', 401),
      ),
    ).toBe(true);
  });

  it('is false for other ApiError statuses', () => {
    expect(isSessionExpiredError(new ApiError('잘못된 요청', 400))).toBe(false);
    expect(isSessionExpiredError(new ApiError('권한 없음', 403))).toBe(false);
    expect(isSessionExpiredError(new ApiError('찾을 수 없음', 404))).toBe(false);
    expect(isSessionExpiredError(new ApiError('서버 오류', 500))).toBe(false);
  });

  it('is false for non-ApiError values', () => {
    expect(isSessionExpiredError(new Error('boom'))).toBe(false);
    expect(isSessionExpiredError(null)).toBe(false);
    expect(isSessionExpiredError(undefined)).toBe(false);
    // A bare object that merely looks 401-shaped is not an ApiError.
    expect(isSessionExpiredError({ status: 401 })).toBe(false);
  });
});

describe('entryPhaseAfterVerify', () => {
  it('routes to the card screen when at least one clause was extracted', () => {
    expect(entryPhaseAfterVerify({ clauses: [clause()] })).toBe('cards');
    expect(
      entryPhaseAfterVerify({ clauses: [clause(), clause({ caution: true })] }),
    ).toBe('cards');
  });

  it('falls straight through to the viewer on a 0-card payload (silent fallback)', () => {
    // The 0-card case must NOT surface an error screen — it lands on the viewer.
    expect(entryPhaseAfterVerify({ clauses: [] })).toBe('viewing');
  });
});

describe('visibleClauseCards', () => {
  it('returns clauses unchanged when within the 1–5 cap', () => {
    const clauses = [clause(), clause(), clause()];
    expect(visibleClauseCards(clauses)).toEqual(clauses);
  });

  it('clamps defensively to at most MAX_CLAUSE_CARDS', () => {
    const clauses = Array.from({ length: 8 }, (_, i) => clause({ page: i + 1 }));
    const visible = visibleClauseCards(clauses);
    expect(visible).toHaveLength(MAX_CLAUSE_CARDS);
    expect(visible[0]?.page).toBe(1);
    expect(visible[MAX_CLAUSE_CARDS - 1]?.page).toBe(MAX_CLAUSE_CARDS);
  });

  it('is empty for no clauses', () => {
    expect(visibleClauseCards([])).toEqual([]);
  });
});

describe('collapse (접기) availability', () => {
  // The viewer projects `onCollapse` — and thus renders the "접기" back button —
  // only when `visibleClauseCards(...).length > 0`, the same gate
  // `entryPhaseAfterVerify` uses to route into the card screen. So the collapse
  // path exists iff the signer entered via cards; a 0-card flow (which lands on
  // the viewer directly) has nothing to return to and hides the affordance.
  it('offers 접기 exactly when the signer entered via clause cards', () => {
    const withClauses = [clause()];
    expect(visibleClauseCards(withClauses).length > 0).toBe(true);
    expect(entryPhaseAfterVerify({ clauses: withClauses })).toBe('cards');
  });

  it('hides 접기 on a 0-card flow (nothing to collapse back to)', () => {
    expect(visibleClauseCards([]).length > 0).toBe(false);
    expect(entryPhaseAfterVerify({ clauses: [] })).toBe('viewing');
  });

  it('labels the back affordance "접기"', () => {
    expect(SIGNER_COPY.viewerCollapse).toBe('접기');
  });
});

describe('signProgress', () => {
  it('derives ratio, fraction label, and incompleteness mid-progress', () => {
    expect(signProgress(4, 2)).toEqual({ ratio: 0.5, label: '2 / 4', complete: false });
  });

  it('is incomplete with a zero ratio when nothing is done yet', () => {
    expect(signProgress(3, 0)).toEqual({ ratio: 0, label: '0 / 3', complete: false });
  });

  it('is complete with a full ratio once every field is done', () => {
    expect(signProgress(4, 4)).toEqual({ ratio: 1, label: '4 / 4', complete: true });
  });

  it('treats an empty field set as complete (nothing to fill)', () => {
    // total 0 must not divide-by-zero — it reads as a full, complete bar.
    expect(signProgress(0, 0)).toEqual({ ratio: 1, label: '0 / 0', complete: true });
  });

  it('clamps done into [0, total] so the bar never over/under-fills', () => {
    // A transient over-count is pinned to total (100%), not past it.
    expect(signProgress(2, 5)).toEqual({ ratio: 1, label: '2 / 2', complete: true });
    // A negative count floors at 0.
    expect(signProgress(4, -1)).toEqual({ ratio: 0, label: '0 / 4', complete: false });
  });

  it('truncates fractional counts to whole fields', () => {
    expect(signProgress(4, 2.9)).toEqual({ ratio: 0.5, label: '2 / 4', complete: false });
  });
});

describe('document viewer CTA copy', () => {
  it('labels the next-field jump and the finalize action per the M-5 spec', () => {
    expect(SIGNER_COPY.viewerCtaContinue).toBe('다음 서명란으로 이동');
    expect(SIGNER_COPY.viewerCtaComplete).toBe('서명 완료하기');
  });
});
