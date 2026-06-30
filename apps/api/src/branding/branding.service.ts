import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { BrandFont } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MESSAGES } from '../common/messages';
import { isBrandingEnabled } from '../common/plan';
import type { UpdateBrandingDto } from './dto/branding.dto';
import {
  contentTypeForBytes,
  detectLogoFormat,
  MAX_LOGO_BYTES,
  sanitizeSvg,
  type UploadedLogo,
} from './logo';

/** Branding as the sender sees it, plus whether their plan may edit it. */
export interface BrandingView {
  brandColor: string | null;
  brandFont: BrandFont | null;
  logoUrl: string | null;
  /** Plan eligibility — the UI gates the editor on this flag. */
  brandingEnabled: boolean;
}

/** Bytes + headers the public serving route needs to stream a logo back. */
export interface ServedLogo {
  buffer: Buffer;
  contentType: string;
  /** SVGs get extra hardening headers (CSP sandbox, inline disposition). */
  isSvg: boolean;
}

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

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

  /**
   * Accept a logo upload from an eligible sender: gate the plan (403), validate
   * the format and size (400 with branding copy), harden the bytes (SVGs are
   * sanitized; rasters are normalized when `sharp` is available, otherwise
   * passed through under the byte cap), persist to a stable public key, and
   * point `User.brandLogoUrl` at the public serving URL.
   */
  async uploadLogo(userId: string, file: UploadedLogo): Promise<BrandingView> {
    await this.assertEligible(userId);

    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException(MESSAGES.branding.logoEmpty);
    }
    if (file.size > MAX_LOGO_BYTES || file.buffer.length > MAX_LOGO_BYTES) {
      throw new BadRequestException(MESSAGES.branding.logoTooLarge);
    }

    const format = detectLogoFormat(file);
    if (!format) {
      throw new BadRequestException(MESSAGES.branding.logoFormat);
    }

    const bytes =
      format === 'svg'
        ? sanitizeSvg(file.buffer)
        : await this.normalizeRaster(file.buffer);

    const key = this.storage.buildBrandingLogoKey(userId);
    await this.storage.save(key, bytes);

    const logoUrl = this.publicLogoUrl(userId, bytes);
    await this.prisma.user.update({
      where: { id: userId },
      data: { brandLogoUrl: logoUrl },
    });

    return this.get(userId);
  }

  /**
   * Clear the sender's logo. Plan-gated like every write path. We null the
   * `brandLogoUrl` pointer (so the signer falls back to the monogram); the
   * stored bytes live at a deterministic key and are overwritten on the next
   * upload, so there is no dangling public reference.
   */
  async removeLogo(userId: string): Promise<BrandingView> {
    await this.assertEligible(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { brandLogoUrl: null },
    });
    return this.get(userId);
  }

  /**
   * Read a user's stored logo for the PUBLIC (unauthenticated) serving route —
   * signers load it before they ever authenticate. No plan gate here: the gate
   * lives on the write paths. Content-Type is sniffed from the bytes so the key
   * needn't encode the format.
   */
  async serveLogo(userId: string): Promise<ServedLogo> {
    const key = this.storage.buildBrandingLogoKey(userId);
    let buffer: Buffer;
    try {
      buffer = await this.storage.read(key);
    } catch {
      throw new NotFoundException();
    }
    if (!buffer || buffer.length === 0) throw new NotFoundException();

    const contentType = contentTypeForBytes(buffer);
    return { buffer, contentType, isSvg: contentType === 'image/svg+xml' };
  }

  // --- internals ----------------------------------------------------------

  /** Shared plan gate for every branding write path (403 for FREE). */
  private async assertEligible(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    if (!user) throw new NotFoundException(MESSAGES.auth.unauthorized);
    if (!isBrandingEnabled(user.plan)) {
      throw new ForbiddenException(MESSAGES.branding.upgradeRequired);
    }
  }

  /**
   * Normalize a raster (JPG/PNG) logo. Uses `sharp` to re-encode and bound the
   * dimensions when it's installed (which also strips any embedded metadata);
   * falls back to the original bytes (already under {@link MAX_LOGO_BYTES})
   * when it isn't, so the feature works without the optional dependency.
   */
  private async normalizeRaster(buffer: Buffer): Promise<Buffer> {
    try {
      // Non-literal specifier: `sharp` is an optional dependency, so we resolve
      // it at runtime and fall back to the original bytes when it's absent
      // (TypeScript must not hard-require the module at build time).
      const moduleName = 'sharp';
      const mod = (await import(moduleName)) as {
        default: (input: Buffer) => {
          resize: (opts: Record<string, unknown>) => {
            rotate: () => { toBuffer: () => Promise<Buffer> };
          };
        };
      };
      return await mod
        .default(buffer)
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .rotate()
        .toBuffer();
    } catch {
      return buffer;
    }
  }

  /**
   * Stable public URL for a user's logo, cache-busted by a short content hash
   * so a re-upload (same deterministic key) invalidates signer/email caches.
   */
  private publicLogoUrl(userId: string, bytes: Buffer): string {
    const origin = (
      this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3001'
    ).replace(/\/+$/, '');
    const version = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    return `${origin}/api/branding/${encodeURIComponent(userId)}/logo?v=${version}`;
  }
}
