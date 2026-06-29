import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { canUseBranding } from '../common/entitlements';
import { MESSAGES } from '../common/messages';
import type { AuthUser } from '../common/current-user.decorator';

/**
 * Entitlement gate for the branding feature.
 *
 * Runs *after* {@link JwtAuthGuard} (declare it second in `@UseGuards`), so the
 * authenticated principal is already on the request. The JWT principal carries
 * only id/email — not the plan — so the current plan is read from the database
 * (it can change between token issuance and now) and checked against the
 * single-source-of-truth allow-set in `common/entitlements.ts`.
 *
 * FREE / PRO → 403 with the Toss-tone upgrade message; TEAM / ENTERPRISE pass.
 */
@Injectable()
export class BrandingGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const principal = request.user;
    if (!principal) {
      throw new UnauthorizedException(MESSAGES.auth.unauthorized);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: principal.id },
      select: { plan: true },
    });
    if (!user || !canUseBranding(user.plan)) {
      throw new ForbiddenException(MESSAGES.branding.forbidden);
    }
    return true;
  }
}
