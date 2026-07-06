/**
 * Terminal (blocked) state mapping for the link-share recipient.
 *
 * Asserts the design-spec contract (components/share-recipient-flow/base.md
 * "blocked 분기 매핑" + messaging/share-link.md "HTTP 코드 매핑 규칙"): the
 * server's HTTP codes (410/403/404) map to the right terminal reason, and each
 * reason carries the right tone (만료/무효/취소/체결불가 = neutral, 이미제출 =
 * success) and the server-mirrored copy. This is the receiver counterpart to the
 * backend `link-state.spec.ts`, pinned on the client side where the screen is
 * actually chosen.
 */

import { ApiError } from './api';
import {
  metaBlockReason,
  unlockBlockReason,
  SHARE_NOTICE,
  SHARE_RECIPIENT_COPY,
  type ShareBlockReason,
} from './share-recipient';

const apiError = (status: number) => new ApiError('boom', status);

describe('metaBlockReason — pre-auth meta failure → terminal reason', () => {
  it('maps 410 Gone to expired (past its validity window)', () => {
    expect(metaBlockReason(apiError(410))).toBe('expired');
  });

  it('maps 404 Not Found to invalidLink (missing token / not a LINK)', () => {
    expect(metaBlockReason(apiError(404))).toBe('invalidLink');
  });

  it('maps 403 Forbidden to disabled (revoked by the sender)', () => {
    expect(metaBlockReason(apiError(403))).toBe('disabled');
  });

  it('falls back to invalidLink for any other status', () => {
    expect(metaBlockReason(apiError(500))).toBe('invalidLink');
    expect(metaBlockReason(apiError(401))).toBe('invalidLink');
  });

  it('falls back to invalidLink for a non-ApiError throwable', () => {
    expect(metaBlockReason(new Error('network'))).toBe('invalidLink');
    expect(metaBlockReason(undefined)).toBe('invalidLink');
  });
});

describe('unlockBlockReason — open-link auto-unlock failure → terminal reason', () => {
  it('maps 403 Forbidden to notSignable (no longer fillable; meta already cleared expiry/revocation)', () => {
    expect(unlockBlockReason(apiError(403))).toBe('notSignable');
  });

  it('falls back to invalidLink for any other status', () => {
    // Expiry/revocation are caught at meta; an unexpected code here is treated as invalid.
    expect(unlockBlockReason(apiError(410))).toBe('invalidLink');
    expect(unlockBlockReason(apiError(404))).toBe('invalidLink');
    expect(unlockBlockReason(apiError(500))).toBe('invalidLink');
  });

  it('falls back to invalidLink for a non-ApiError throwable', () => {
    expect(unlockBlockReason('nope')).toBe('invalidLink');
  });
});

describe('SHARE_NOTICE — tone + copy per terminal reason', () => {
  it('covers every block reason exactly once', () => {
    const reasons: ShareBlockReason[] = [
      'expired',
      'disabled',
      'invalidLink',
      'notSignable',
      'alreadySubmitted',
    ];
    expect(Object.keys(SHARE_NOTICE).sort()).toEqual([...reasons].sort());
  });

  it('uses a calm neutral tone for every non-openable dead-end', () => {
    expect(SHARE_NOTICE.expired.tone).toBe('neutral');
    expect(SHARE_NOTICE.disabled.tone).toBe('neutral');
    expect(SHARE_NOTICE.invalidLink.tone).toBe('neutral');
    expect(SHARE_NOTICE.notSignable.tone).toBe('neutral');
  });

  it('uses a success tone only for an already-submitted (completed) link', () => {
    expect(SHARE_NOTICE.alreadySubmitted.tone).toBe('success');
  });

  it('mirrors the server-catalog copy (title + body) for each reason', () => {
    for (const reason of Object.keys(SHARE_NOTICE) as ShareBlockReason[]) {
      expect(SHARE_NOTICE[reason].title).toBe(SHARE_RECIPIENT_COPY.notice[reason].title);
      expect(SHARE_NOTICE[reason].body).toBe(SHARE_RECIPIENT_COPY.notice[reason].body);
    }
  });

  it('mirrors the expired-link copy the spec pins to the "만료된 링크" screen', () => {
    // Spec deliverable: the expired notice tells the recipient it is time (not
    // their fault) and offers the one next step — request a new link.
    expect(SHARE_NOTICE.expired.title).toBe('링크가 만료됐어요');
    expect(SHARE_NOTICE.expired.body).toContain('유효 기간이 지났어요');
    expect(SHARE_NOTICE.expired.body).toContain('새 링크를 요청');
  });
});
