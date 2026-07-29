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
import { isSessionExpiredError } from './signing';

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
