import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { MESSAGES } from '../common/messages';
import { PrismaService } from '../prisma/prisma.service';
import { SignerSessionService, type SignerSession } from './signer-session.service';

/**
 * Protects the signer-only endpoints (payload / pdf / fields / complete).
 *
 * Validates the short-lived bearer session token AND re-checks that the token
 * is bound to the very SignRequest addressed by the `:token` (accessToken)
 * route param — so a session for one signing link can never read another.
 */
@Injectable()
export class SignerSessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SignerSessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request<{ token: string }> & { signer: SignerSession }>();

    const bearer = extractBearer(request.headers.authorization);
    const session = this.sessions.verify(bearer);

    const accessToken = request.params?.token;
    if (!accessToken) {
      throw new NotFoundException(MESSAGES.signing.invalidLink);
    }

    const signRequest = await this.prisma.signRequest.findUnique({
      where: { accessToken },
      select: { id: true },
    });
    if (!signRequest) {
      throw new NotFoundException(MESSAGES.signing.invalidLink);
    }

    // The session must belong to the link being accessed.
    if (signRequest.id !== session.signRequestId) {
      throw new UnauthorizedException(MESSAGES.signing.sessionExpired);
    }

    request.signer = { signRequestId: signRequest.id };
    return true;
  }
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
  return value.trim();
}
