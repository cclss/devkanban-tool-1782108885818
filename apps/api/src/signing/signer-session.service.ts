import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MESSAGES } from '../common/messages';
import { SIGNER_SESSION_TTL_MINUTES } from '../common/messages';

/**
 * Default signer-session secret for local dev. Production must set
 * SIGNER_JWT_SECRET. Intentionally distinct from the sender JWT secret so a
 * short-lived signer token can never be used as a sender (dashboard) token.
 */
export const DEFAULT_SIGNER_JWT_SECRET = 'dev-local-signer-secret-change-me';

/** Marks the token's audience so sender JWTs can't cross over. */
const SIGNER_TOKEN_TYPE = 'signer-session';

interface SignerTokenPayload {
  /** SignRequest.id this session is bound to. */
  sub: string;
  /** Audience guard. */
  typ: typeof SIGNER_TOKEN_TYPE;
}

/** The signer principal attached to a request after the session guard passes. */
export interface SignerSession {
  signRequestId: string;
}

/**
 * Issues and validates the short-lived (~30min) signer session token. The
 * token is bound to a single SignRequest.id and carries no sender identity.
 */
@Injectable()
export class SignerSessionService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get secret(): string {
    return this.config.get<string>('SIGNER_JWT_SECRET') ?? DEFAULT_SIGNER_JWT_SECRET;
  }

  /** Sign a session token bound to the given SignRequest. */
  issue(signRequestId: string): string {
    const payload: SignerTokenPayload = { sub: signRequestId, typ: SIGNER_TOKEN_TYPE };
    return this.jwt.sign(payload, {
      secret: this.secret,
      expiresIn: `${SIGNER_SESSION_TTL_MINUTES}m`,
    });
  }

  /**
   * Verify a bearer token and return the bound SignRequest id. Throws a
   * Toss-tone "다시 인증" message on any failure (expired / malformed / wrong
   * audience) so the signer is guided back to the code screen.
   */
  verify(token: string | undefined): SignerSession {
    if (!token) {
      throw new UnauthorizedException(MESSAGES.signing.sessionExpired);
    }
    try {
      const payload = this.jwt.verify<SignerTokenPayload>(token, { secret: this.secret });
      if (payload.typ !== SIGNER_TOKEN_TYPE || !payload.sub) {
        throw new UnauthorizedException(MESSAGES.signing.sessionExpired);
      }
      return { signRequestId: payload.sub };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException(MESSAGES.signing.sessionExpired);
    }
  }
}
