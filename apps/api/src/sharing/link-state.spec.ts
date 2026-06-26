import { ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { SignRequestAccessMode, SignRequestStatus } from '@repo/db';
import {
  assertLinkAccessible,
  deriveLinkState,
  type LinkAccessFields,
} from './link-state';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-26T00:00:00.000Z');

/** A minimal accessible LINK row; spread + override per case. */
const linkRow = (over: Partial<LinkAccessFields> = {}): LinkAccessFields => ({
  accessMode: SignRequestAccessMode.LINK,
  status: SignRequestStatus.VIEWED,
  linkExpiresAt: null,
  linkRevokedAt: null,
  ...over,
});

describe('deriveLinkState', () => {
  it('returns active for a fresh, unexpired, in-progress link', () => {
    expect(deriveLinkState(linkRow(), NOW)).toBe('active');
  });

  it('returns active when expiry is in the future', () => {
    expect(
      deriveLinkState({ ...linkRow(), linkExpiresAt: new Date(NOW.getTime() + DAY) }, NOW),
    ).toBe('active');
  });

  it('returns expired once the expiry instant has passed', () => {
    expect(
      deriveLinkState({ ...linkRow(), linkExpiresAt: new Date(NOW.getTime() - 1) }, NOW),
    ).toBe('expired');
  });

  it('treats the exact expiry instant as expired (boundary, <=)', () => {
    expect(deriveLinkState({ ...linkRow(), linkExpiresAt: new Date(NOW) }, NOW)).toBe('expired');
  });

  it('returns revoked when the link was disabled by the sender', () => {
    expect(deriveLinkState({ ...linkRow(), linkRevokedAt: NOW }, NOW)).toBe('revoked');
  });

  it('returns completed for a submitted (SIGNED) link', () => {
    expect(deriveLinkState({ ...linkRow(), status: SignRequestStatus.SIGNED }, NOW)).toBe(
      'completed',
    );
  });

  it('prioritises revocation over expiry and completion', () => {
    expect(
      deriveLinkState(
        {
          ...linkRow(),
          status: SignRequestStatus.SIGNED,
          linkExpiresAt: new Date(NOW.getTime() - DAY),
          linkRevokedAt: NOW,
        },
        NOW,
      ),
    ).toBe('revoked');
  });

  it('prioritises expiry over completion', () => {
    expect(
      deriveLinkState(
        {
          ...linkRow(),
          status: SignRequestStatus.SIGNED,
          linkExpiresAt: new Date(NOW.getTime() - DAY),
        },
        NOW,
      ),
    ).toBe('expired');
  });

  it('defaults `now` to the current time when omitted', () => {
    // A far-future expiry must read as active regardless of the wall clock.
    expect(
      deriveLinkState({ ...linkRow(), linkExpiresAt: new Date(NOW.getTime() + 1000 * DAY) }),
    ).toBe('active');
  });
});

describe('assertLinkAccessible', () => {
  it('returns the derived state for an accessible active link', () => {
    expect(assertLinkAccessible(linkRow(), NOW)).toBe('active');
  });

  it('returns completed for an accessible submitted link', () => {
    expect(assertLinkAccessible({ ...linkRow(), status: SignRequestStatus.SIGNED }, NOW)).toBe(
      'completed',
    );
  });

  it('throws 404 when the row is null', () => {
    expect(() => assertLinkAccessible(null, NOW)).toThrow(NotFoundException);
  });

  it('throws 404 when the row is undefined', () => {
    expect(() => assertLinkAccessible(undefined, NOW)).toThrow(NotFoundException);
  });

  it('throws 404 for a CODE-mode request (not a share link)', () => {
    expect(() =>
      assertLinkAccessible(linkRow({ accessMode: SignRequestAccessMode.CODE }), NOW),
    ).toThrow(NotFoundException);
  });

  it('throws 403 for a revoked link', () => {
    expect(() => assertLinkAccessible(linkRow({ linkRevokedAt: NOW }), NOW)).toThrow(
      ForbiddenException,
    );
  });

  it('throws 410 for an expired link', () => {
    expect(() =>
      assertLinkAccessible(linkRow({ linkExpiresAt: new Date(NOW.getTime() - DAY) }), NOW),
    ).toThrow(GoneException);
  });

  it('prefers 404 (not LINK) over revoked/expired lifecycle checks', () => {
    expect(() =>
      assertLinkAccessible(
        linkRow({ accessMode: SignRequestAccessMode.CODE, linkRevokedAt: NOW }),
        NOW,
      ),
    ).toThrow(NotFoundException);
  });
});
