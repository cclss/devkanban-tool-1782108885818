import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MESSAGES, SHARE_SESSION_TTL_MINUTES } from '../common/messages';

/**
 * Default share-session secret for local dev. Production must set
 * SHARE_JWT_SECRET. Intentionally distinct from both the sender JWT and the
 * signer-session secret so a share token can never cross over into either flow.
 */
export const DEFAULT_SHARE_JWT_SECRET = 'dev-local-share-secret-change-me';

/** Marks the token's audience so sender/signer tokens can't cross over. */
const SHARE_TOKEN_TYPE = 'share-session';

interface ShareTokenPayload {
  /** SignRequest.id (LINK mode) this session is bound to. */
  sub: string;
  /** Audience guard. */
  typ: typeof SHARE_TOKEN_TYPE;
}

/** The share principal attached to a request after the session guard passes. */
export interface ShareSession {
  signRequestId: string;
}

/**
 * Issues and validates the short-lived share session token. The token is bound
 * to a single LINK-mode SignRequest.id and carries no sender identity. A signer
 * (OTP) session token can never satisfy this guard, and vice-versa, because the
 * audience (`typ`) and secret both differ.
 */
@Injectable()
export class ShareSessionService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get secret(): string {
    return this.config.get<string>('SHARE_JWT_SECRET') ?? DEFAULT_SHARE_JWT_SECRET;
  }

  /** Sign a session token bound to the given LINK SignRequest. */
  issue(signRequestId: string): string {
    const payload: ShareTokenPayload = { sub: signRequestId, typ: SHARE_TOKEN_TYPE };
    return this.jwt.sign(payload, {
      secret: this.secret,
      expiresIn: `${SHARE_SESSION_TTL_MINUTES}m`,
    });
  }

  /**
   * Verify a bearer token and return the bound SignRequest id. Throws a
   * Toss-tone "다시 열어 주세요" message on any failure (expired / malformed /
   * wrong audience) so the recipient is guided back to the link.
   */
  verify(token: string | undefined): ShareSession {
    if (!token) {
      throw new UnauthorizedException(MESSAGES.share.sessionExpired);
    }
    try {
      const payload = this.jwt.verify<ShareTokenPayload>(token, { secret: this.secret });
      if (payload.typ !== SHARE_TOKEN_TYPE || !payload.sub) {
        throw new UnauthorizedException(MESSAGES.share.sessionExpired);
      }
      return { signRequestId: payload.sub };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException(MESSAGES.share.sessionExpired);
    }
  }
}
