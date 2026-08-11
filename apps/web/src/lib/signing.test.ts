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
  completionArtifactState,
  completionSummaryRows,
  deserializeFieldValue,
  entryPhaseAfterVerify,
  formatSignedAt,
  isSessionExpiredError,
  reentryArtifactState,
  reentrySummary,
  serializeFieldValue,
  signProgress,
  visibleClauseCards,
  MAX_CLAUSE_CARDS,
  SIGNER_COPY,
  type ExtractedClause,
  type SigningMeta,
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

describe('deserializeFieldValue (M-6 session restore)', () => {
  it('restores a SIGNATURE data URL verbatim', () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    expect(deserializeFieldValue('SIGNATURE', dataUrl)).toEqual({
      type: 'SIGNATURE',
      dataUrl,
    });
  });

  it('restores a DATE value as its ISO text', () => {
    expect(deserializeFieldValue('DATE', '2026-08-11')).toEqual({
      type: 'DATE',
      text: '2026-08-11',
    });
  });

  it('restores a TEXT value as its text (font is not recoverable)', () => {
    expect(deserializeFieldValue('TEXT', '홍길동')).toEqual({
      type: 'TEXT',
      text: '홍길동',
    });
  });

  it('returns null for an unfilled field (null value)', () => {
    expect(deserializeFieldValue('SIGNATURE', null)).toBeNull();
    expect(deserializeFieldValue('TEXT', null)).toBeNull();
    expect(deserializeFieldValue('DATE', null)).toBeNull();
  });

  it('returns null for an empty / whitespace-only value', () => {
    expect(deserializeFieldValue('SIGNATURE', '')).toBeNull();
    expect(deserializeFieldValue('TEXT', '   ')).toBeNull();
    expect(deserializeFieldValue('DATE', '')).toBeNull();
  });

  it('trims surrounding whitespace on TEXT / DATE values', () => {
    expect(deserializeFieldValue('TEXT', '  홍길동  ')).toEqual({
      type: 'TEXT',
      text: '홍길동',
    });
  });

  it('is the inverse of serializeFieldValue for each field type', () => {
    const dataUrl = 'data:image/png;base64,BBBB';
    expect(
      serializeFieldValue(deserializeFieldValue('SIGNATURE', dataUrl)!),
    ).toBe(dataUrl);
    expect(serializeFieldValue(deserializeFieldValue('TEXT', '값')!)).toBe('값');
    expect(
      serializeFieldValue(deserializeFieldValue('DATE', '2026-08-11')!),
    ).toBe('2026-08-11');
  });
});

describe('formatSignedAt (M-7 서명 완료 시각)', () => {
  it('formats an ISO instant in ko-KR pinned to KST (device-timezone independent)', () => {
    // 2026-08-11T05:30:00Z → 2026-08-11 14:30 KST → "오후 2:30".
    const label = formatSignedAt('2026-08-11T05:30:00.000Z');
    expect(label).toContain('2026년');
    expect(label).toContain('8월');
    expect(label).toContain('11일');
    expect(label).toContain('오후');
    expect(label).toContain('2:30');
  });

  it('rolls the KST day forward for a late-UTC instant', () => {
    // 2026-08-11T20:00:00Z → 2026-08-12 05:00 KST (next KST day).
    const label = formatSignedAt('2026-08-11T20:00:00.000Z');
    expect(label).toContain('12일');
    expect(label).toContain('오전');
  });

  it('returns an empty string for an absent or unparseable value (row omitted)', () => {
    expect(formatSignedAt(null)).toBe('');
    expect(formatSignedAt('')).toBe('');
    expect(formatSignedAt('not-a-date')).toBe('');
  });
});

describe('completionSummaryRows (M-7 요약 카드 실제 값 + 생략 규칙)', () => {
  it('emits 날짜 → 금액 → 서명시각 in reading order when all are present', () => {
    const rows = completionSummaryRows({
      signedAt: '2026-08-11T05:30:00.000Z',
      contractDate: '2026년 8월 1일',
      contractAmount: '5,000,000원',
    });
    expect(rows.map((r) => r.key)).toEqual(['contractDate', 'contractAmount', 'signedAt']);
    expect(rows[0]).toEqual({ key: 'contractDate', value: '2026년 8월 1일' });
    expect(rows[1]).toEqual({ key: 'contractAmount', value: '5,000,000원' });
    expect(rows[2]?.value).toContain('오후');
  });

  it('omits rows whose fact is null/blank (spec §6 추출 가능한 경우)', () => {
    const rows = completionSummaryRows({
      signedAt: '2026-08-11T05:30:00.000Z',
      contractDate: null,
      contractAmount: '   ',
    });
    // Only the always-present signed timestamp survives.
    expect(rows.map((r) => r.key)).toEqual(['signedAt']);
  });

  it('is empty when nothing is derivable (no card rows render)', () => {
    expect(
      completionSummaryRows({ signedAt: null, contractDate: null, contractAmount: null }),
    ).toEqual([]);
  });

  it('passes raw date/amount figures through verbatim (already Korean substrings)', () => {
    const rows = completionSummaryRows({
      signedAt: null,
      contractDate: '2026. 8. 1.',
      contractAmount: '금 오백만원정',
    });
    expect(rows).toEqual([
      { key: 'contractDate', value: '2026. 8. 1.' },
      { key: 'contractAmount', value: '금 오백만원정' },
    ]);
  });
});

describe('completionArtifactState (M-7 다운로드/준비중 분기)', () => {
  it('shows the download button once the final PDF is ready', () => {
    expect(
      completionArtifactState({ hasDownload: true, documentReady: true, documentCompleted: true }),
    ).toBe('download');
  });

  it('shows the 준비 중 notice while a completed document is still generating its PDF', () => {
    expect(
      completionArtifactState({ hasDownload: true, documentReady: false, documentCompleted: true }),
    ).toBe('processing');
  });

  it('shows neither when the document is not yet complete (others pending)', () => {
    expect(
      completionArtifactState({ hasDownload: true, documentReady: false, documentCompleted: false }),
    ).toBe('none');
  });

  it('shows nothing for a flow without a download (e.g. the share flow)', () => {
    expect(
      completionArtifactState({ hasDownload: false, documentReady: true, documentCompleted: true }),
    ).toBe('none');
  });
});

/** Minimal already-signed meta factory for the re-entry projection tests. */
function signedMeta(overrides: Partial<SigningMeta> = {}): SigningMeta {
  return {
    documentTitle: '용역 계약서',
    pageCount: 3,
    documentStatus: 'COMPLETED',
    sender: { name: '아크미', brandColor: null, brandLogoUrl: null },
    recipientNameMasked: '홍*동',
    status: 'SIGNED',
    alreadySigned: true,
    signable: false,
    signedAt: '2026-08-11T05:30:00.000Z',
    contractDate: '2026년 8월 1일',
    contractAmount: '5,000,000원',
    documentReady: true,
    ...overrides,
  };
}

describe('reentrySummary (재접속 요약 카드 팩트 투영)', () => {
  it('projects the signed meta facts onto the completion summary shape', () => {
    expect(reentrySummary(signedMeta())).toEqual({
      signedAt: '2026-08-11T05:30:00.000Z',
      contractDate: '2026년 8월 1일',
      contractAmount: '5,000,000원',
    });
  });

  it('feeds completionSummaryRows so re-entry reuses the same 날짜→금액→시각 rows', () => {
    const rows = completionSummaryRows(reentrySummary(signedMeta()));
    expect(rows.map((r) => r.key)).toEqual(['contractDate', 'contractAmount', 'signedAt']);
    expect(rows[0]?.value).toBe('2026년 8월 1일');
    expect(rows[1]?.value).toBe('5,000,000원');
    expect(rows[2]?.value).toContain('오후');
  });

  it('omits rows for facts the server could not extract (null passes through)', () => {
    const rows = completionSummaryRows(
      reentrySummary(signedMeta({ contractDate: null, contractAmount: null })),
    );
    // Only the always-present signed timestamp survives on re-entry too.
    expect(rows.map((r) => r.key)).toEqual(['signedAt']);
  });
});

describe('reentryArtifactState (재접속 다운로드/준비중 분기)', () => {
  it('offers the download once the final signed PDF is ready', () => {
    expect(reentryArtifactState(signedMeta({ documentReady: true }))).toBe('download');
  });

  it('shows 준비 중 while a completed document is still generating its PDF', () => {
    expect(
      reentryArtifactState(signedMeta({ documentStatus: 'COMPLETED', documentReady: false })),
    ).toBe('processing');
  });

  it('shows neither while the document is not yet complete (others still pending)', () => {
    // This signer signed, but the whole doc is still IN_PROGRESS → nothing to
    // download and nothing being generated yet.
    expect(
      reentryArtifactState(signedMeta({ documentStatus: 'IN_PROGRESS', documentReady: false })),
    ).toBe('none');
  });
});

describe('re-entry copy (재접속 "이미 서명 완료" 메시지)', () => {
  it('uses the spec-exact re-entry headline', () => {
    expect(SIGNER_COPY.reentry.title).toBe('이미 서명 완료된 계약입니다');
  });

  it('names the download re-auth requirement (세션 없는 재접속)', () => {
    expect(SIGNER_COPY.reentry.downloadReauth).toContain('본인확인');
  });
});

describe('completion copy (M-7 요약 카드 라벨 + 준비중 안내)', () => {
  it('labels each summary fact row', () => {
    expect(SIGNER_COPY.done.contractDateLabel).toBe('계약 날짜');
    expect(SIGNER_COPY.done.contractAmountLabel).toBe('계약 금액');
    expect(SIGNER_COPY.done.signedAtLabel).toBe('서명 완료 시각');
  });

  it('provides a 계약서 준비 중 notice for the in-progress artifact state', () => {
    expect(SIGNER_COPY.done.processing).toContain('준비 중');
  });
});
