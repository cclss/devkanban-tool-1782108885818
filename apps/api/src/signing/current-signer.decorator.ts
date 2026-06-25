import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { SignerSession } from './signer-session.service';

/**
 * Convenience decorator: `@CurrentSigner() signer: SignerSession`.
 * Reads the signer principal that {@link SignerSessionGuard} attached to the
 * request after validating the short-lived session token.
 */
export const CurrentSigner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SignerSession => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { signer: SignerSession }>();
    return request.signer;
  },
);
