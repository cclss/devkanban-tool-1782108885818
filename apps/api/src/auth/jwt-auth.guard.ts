import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MESSAGES } from '../common/messages';
import type { AuthUser } from '../common/current-user.decorator';

/**
 * Guards routes behind a valid JWT. Overrides the failure handler so the
 * client receives the Toss-tone Korean message instead of Passport's default.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw new UnauthorizedException(MESSAGES.auth.unauthorized);
    }
    return user;
  }

  // Present for symmetry / future request-scoped logic.
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
