import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Authenticated principal attached to the request by {@link JwtStrategy}. */
export interface AuthUser {
  id: string;
  email: string;
}

/**
 * Convenience decorator: `@CurrentUser() user: AuthUser`.
 * Reads the principal that the JWT strategy validated onto `req.user`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
    return request.user;
  },
);
