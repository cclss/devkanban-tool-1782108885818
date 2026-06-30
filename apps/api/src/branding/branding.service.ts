import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { BrandFont } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGES } from '../common/messages';
import { isBrandingEnabled } from '../common/plan';
import type { UpdateBrandingDto } from './dto/branding.dto';

/** Branding as the sender sees it, plus whether their plan may edit it. */
export interface BrandingView {
  brandColor: string | null;
  brandFont: BrandFont | null;
  logoUrl: string | null;
  /** Plan eligibility — the UI gates the editor on this flag. */
  brandingEnabled: boolean;
}

@Injectable()
export class BrandingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Current branding for the signed-in sender. Readable on every plan so the
   * UI can show the upsell state; `brandingEnabled` carries the entitlement.
   */
  async get(userId: string): Promise<BrandingView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { brandColor: true, brandFont: true, brandLogoUrl: true, plan: true },
    });
    if (!user) throw new NotFoundException(MESSAGES.auth.unauthorized);

    return {
      brandColor: user.brandColor,
      brandFont: user.brandFont,
      logoUrl: user.brandLogoUrl,
      brandingEnabled: isBrandingEnabled(user.plan),
    };
  }

  /**
   * Persist brand color / font for an eligible sender. Field shape is already
   * validated by the DTO; here we enforce the plan gate (403 for FREE) and
   * write only the fields the caller actually supplied (`undefined` = leave as
   * is, explicit `null` = clear back to the default tokens).
   */
  async update(userId: string, dto: UpdateBrandingDto): Promise<BrandingView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    if (!user) throw new NotFoundException(MESSAGES.auth.unauthorized);
    if (!isBrandingEnabled(user.plan)) {
      throw new ForbiddenException(MESSAGES.branding.upgradeRequired);
    }

    const data: { brandColor?: string | null; brandFont?: BrandFont | null } = {};
    if (dto.brandColor !== undefined) data.brandColor = dto.brandColor;
    if (dto.brandFont !== undefined) data.brandFont = dto.brandFont;

    await this.prisma.user.update({ where: { id: userId }, data });
    return this.get(userId);
  }
}
