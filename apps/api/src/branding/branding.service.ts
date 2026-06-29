import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Plan } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MESSAGES } from '../common/messages';
import { canUseBranding } from '../common/entitlements';
import {
  BRAND_FONTS,
  DEFAULT_BRAND_FONT_KEY,
  isBrandFontKey,
  type BrandFont,
} from './branding.constants';
import {
  isHexColor,
  LOGO_TYPE_CONTENT_TYPE,
  LOGO_TYPE_EXTENSION,
  MAX_LOGO_BYTES,
  RECOMMENDED_LOGO_MAX_DIM,
  resolveLogoType,
  type LogoType,
} from './branding.validation';

/** A multipart logo upload as delivered by Multer. */
export interface LogoUpload {
  originalname?: string;
  mimetype?: string;
  buffer: Buffer;
  size: number;
}

/** Plan entitlement summary returned alongside branding. */
export interface BrandingEntitlement {
  plan: Plan;
  canUseBranding: boolean;
}

/** The branding view returned by every read/write endpoint. */
export interface BrandingView {
  /** Selected brand color (hex), or null when unset. */
  brandColor: string | null;
  /** Selected font key — always resolvable (defaults to the app body font). */
  brandFont: string;
  /** Servable URL for the current logo, or null when none. */
  brandLogoUrl: string | null;
  /** The closed font catalog (dropdown source for the admin UI). */
  fonts: readonly BrandFont[];
  /** Plan/entitlement snapshot. */
  entitlement: BrandingEntitlement;
}

/** Internal path prefix the logo-serving route is restricted to. */
const LOGO_KEY_PREFIX = 'branding/';

/**
 * Owns the branding read/write logic: reading the current config, validating &
 * persisting color/font, and the logo storage I/O (format + size + anti-spoof
 * validation, raster downscaling, namespaced storage, servable URL).
 *
 * Plan entitlement is enforced by {@link BrandingGuard} at the route layer
 * (reusing `canUseBranding`), so this service assumes the caller is allowed and
 * focuses on input validation + storage.
 */
@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Current branding + entitlement for the owner. */
  async getBranding(ownerId: string): Promise<BrandingView> {
    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { plan: true, brandColor: true, brandFont: true, brandLogoUrl: true },
    });
    if (!user) throw new UnauthorizedException(MESSAGES.auth.unauthorized);

    return {
      brandColor: user.brandColor ?? null,
      brandFont: user.brandFont ?? DEFAULT_BRAND_FONT_KEY,
      brandLogoUrl: user.brandLogoUrl ?? null,
      fonts: BRAND_FONTS,
      entitlement: { plan: user.plan, canUseBranding: canUseBranding(user.plan) },
    };
  }

  /**
   * Validate & persist color/font. Each field is optional; a present color must
   * be a hex string and a present font must be a catalog key, else a Toss-tone
   * 400. Returns the refreshed branding view.
   */
  async updateBranding(
    ownerId: string,
    input: { brandColor?: string; brandFont?: string },
  ): Promise<BrandingView> {
    const data: { brandColor?: string; brandFont?: string } = {};

    if (input.brandColor !== undefined) {
      if (!isHexColor(input.brandColor)) {
        throw new BadRequestException(MESSAGES.branding.invalidColor);
      }
      data.brandColor = input.brandColor;
    }

    if (input.brandFont !== undefined) {
      if (!isBrandFontKey(input.brandFont)) {
        throw new BadRequestException(MESSAGES.branding.invalidFont);
      }
      data.brandFont = input.brandFont;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: ownerId }, data });
    }
    return this.getBranding(ownerId);
  }

  /**
   * Validate, normalize, store a logo and update `brandLogoUrl`.
   *
   * Pipeline: empty → 400; over 2MB → 400; content-sniff the real type
   * (extension/MIME forgery is rejected here, not trusted); raster (PNG/JPEG)
   * downscaled to the recommended size; SVG stored verbatim after validation.
   * The previous logo (if any) is best-effort removed to avoid orphan blobs.
   */
  async uploadLogo(ownerId: string, file: LogoUpload | undefined): Promise<BrandingView> {
    if (!file || !file.buffer || file.size === 0 || file.buffer.length === 0) {
      throw new BadRequestException(MESSAGES.branding.logoEmpty);
    }
    if (file.size > MAX_LOGO_BYTES || file.buffer.length > MAX_LOGO_BYTES) {
      throw new BadRequestException(MESSAGES.branding.logoTooLarge);
    }

    const type = resolveLogoType(file);
    if (!type) {
      throw new BadRequestException(MESSAGES.branding.logoInvalidType);
    }

    const bytes =
      type === 'svg' ? file.buffer : await this.downscaleRaster(file.buffer, type);

    const key = this.storage.buildImageKey(ownerId, LOGO_TYPE_EXTENSION[type]);
    await this.storage.save(key, bytes, LOGO_TYPE_CONTENT_TYPE[type]);

    const previous = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { brandLogoUrl: true },
    });
    await this.prisma.user.update({
      where: { id: ownerId },
      data: { brandLogoUrl: this.logoUrl(key) },
    });
    await this.removePreviousLogo(previous?.brandLogoUrl ?? null, key);

    return this.getBranding(ownerId);
  }

  /** Remove the current logo (best-effort storage delete) and clear the URL. */
  async deleteLogo(ownerId: string): Promise<BrandingView> {
    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { brandLogoUrl: true },
    });
    if (user?.brandLogoUrl) {
      const key = logoKeyFromUrl(user.brandLogoUrl);
      if (key) await this.storage.remove(key);
      await this.prisma.user.update({
        where: { id: ownerId },
        data: { brandLogoUrl: null },
      });
    }
    return this.getBranding(ownerId);
  }

  /**
   * Open the bytes of a stored logo for the public serving route. Restricted to
   * the `branding/` namespace so contract PDFs can never be read through it.
   */
  resolveLogoKey(key: string | undefined): string {
    if (!key || key.includes('..') || !key.startsWith(LOGO_KEY_PREFIX)) {
      throw new BadRequestException(MESSAGES.branding.logoNotFound);
    }
    return key;
  }

  /** Re-encode a raster to fit within the recommended box (never upscaling). */
  private async downscaleRaster(buffer: Buffer, type: LogoType): Promise<Buffer> {
    let sharp: typeof import('sharp').default;
    try {
      sharp = (await import('sharp')).default;
    } catch (err) {
      // Image toolchain unavailable — store the (already validated) original.
      this.logger.warn(`sharp 미사용 — 원본 저장으로 폴백: ${String(err)}`);
      return buffer;
    }
    try {
      return await sharp(buffer)
        .resize({
          width: RECOMMENDED_LOGO_MAX_DIM,
          height: RECOMMENDED_LOGO_MAX_DIM,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer();
    } catch (err) {
      // Header passed magic sniff but the body is corrupt/undecodable.
      this.logger.warn(`로고 이미지 처리 실패 type=${type}: ${String(err)}`);
      throw new BadRequestException(MESSAGES.branding.logoUnreadable);
    }
  }

  /** Best-effort delete of a replaced logo (skips when same key / unparsable). */
  private async removePreviousLogo(
    previousUrl: string | null,
    currentKey: string,
  ): Promise<void> {
    if (!previousUrl) return;
    const previousKey = logoKeyFromUrl(previousUrl);
    if (!previousKey || previousKey === currentKey) return;
    await this.storage.remove(previousKey);
  }

  /** Build the relative, servable URL for a stored logo key. */
  private logoUrl(key: string): string {
    return `/api/branding/logo/file?key=${encodeURIComponent(key)}`;
  }
}

/** Recover the storage key from a stored logo serving URL. */
export function logoKeyFromUrl(url: string): string | null {
  const query = url.split('?')[1];
  if (!query) return null;
  for (const part of query.split('&')) {
    const [name, value] = part.split('=');
    if (name === 'key' && value) return decodeURIComponent(value);
  }
  return null;
}
