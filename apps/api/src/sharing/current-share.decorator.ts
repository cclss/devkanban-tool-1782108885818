import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ShareSession } from './share-session.service';

/**
 * Convenience decorator: `@CurrentShare() share: ShareSession`.
 * Reads the share principal that {@link ShareSessionGuard} attached to `req.share`.
 */
export const CurrentShare = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ShareSession => {
    const request = ctx.switchToHttp().getRequest<Request & { share: ShareSession }>();
    return request.share;
  },
);
