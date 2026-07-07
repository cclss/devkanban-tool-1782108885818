import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MESSAGES } from '../common/messages';
import {
  validateBrandingImage,
  type BrandingAssetKind,
  type BrandingImageError,
  type UploadedImage,
} from './image-validation';

/**
 * Fixed primary key of the single global branding row. Matches the Prisma
 * default (`@default("GLOBAL")`) so callers upsert/read one settings row
 * without carrying an id around.
 */
const GLOBAL_BRANDING_ID = 'GLOBAL';

/** Public branding payload — asset URLs point at the serving route. */
export interface BrandingResponse {
  logoUrl: string | null;
  faviconUrl: string | null;
  brandColor: string | null;
}

/** Map a validation error to its Toss-tone user-facing copy. */
const IMAGE_ERROR_MESSAGE: Record<BrandingImageError, string> = {
  emptyFile: MESSAGES.branding.emptyFile,
  fileTooLarge: MESSAGES.branding.fileTooLarge,
  invalidType: MESSAGES.branding.invalidType,
};

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Validate and persist a logo/favicon upload, then upsert its storage key +
   * Content-Type onto the singleton branding row. Returns the fresh public view.
   */
  async saveAsset(
    kind: BrandingAssetKind,
    file: UploadedImage | undefined,
  ): Promise<BrandingResponse> {
    const result = validateBrandingImage(file);
    if (!result.ok) {
      throw new BadRequestException(IMAGE_ERROR_MESSAGE[result.error]);
    }

    // A fresh UUID per upload (via buildBrandingKey) means replacing an asset
    // never overwrites the previous object and the serving URL's cache-busting
    // version changes, so end users see the new asset immediately.
    const key = this.storage.buildBrandingKey(kind, file!.originalname);
    await this.storage.save(key, file!.buffer, result.contentType);

    const data =
      kind === 'logo'
        ? { logoStorageKey: key, logoContentType: result.contentType }
        : { faviconStorageKey: key, faviconContentType: result.contentType };

    await this.prisma.brandingSettings.upsert({
      where: { id: GLOBAL_BRANDING_ID },
      create: { id: GLOBAL_BRANDING_ID, ...data },
      update: data,
    });

    return this.get();
  }

  /** Persist the primary brand color (hex, validated at the DTO boundary). */
  async updateColor(brandColor: string): Promise<BrandingResponse> {
    await this.prisma.brandingSettings.upsert({
      where: { id: GLOBAL_BRANDING_ID },
      create: { id: GLOBAL_BRANDING_ID, brandColor },
      update: { brandColor },
    });
    return this.get();
  }

  /** Public branding view: current color + serving URLs for stored assets. */
  async get(): Promise<BrandingResponse> {
    const settings = await this.prisma.brandingSettings.findUnique({
      where: { id: GLOBAL_BRANDING_ID },
    });
    return {
      logoUrl: buildAssetUrl('logo', settings?.logoStorageKey ?? null),
      faviconUrl: buildAssetUrl('favicon', settings?.faviconStorageKey ?? null),
      brandColor: settings?.brandColor ?? null,
    };
  }

  /**
   * Open a stored asset's bytes for streaming, alongside the Content-Type it
   * was saved with (so SVG vs PNG is served correctly). Throws 404 when the
   * asset has never been set.
   */
  async openAsset(
    kind: BrandingAssetKind,
  ): Promise<{ stream: Readable; contentType: string }> {
    const settings = await this.prisma.brandingSettings.findUnique({
      where: { id: GLOBAL_BRANDING_ID },
    });
    const key = kind === 'logo' ? settings?.logoStorageKey : settings?.faviconStorageKey;
    const contentType =
      kind === 'logo' ? settings?.logoContentType : settings?.faviconContentType;
    if (!settings || !key) {
      throw new NotFoundException(MESSAGES.branding.assetNotFound);
    }
    const stream = await this.storage.openStream(key);
    return { stream, contentType: contentType ?? 'application/octet-stream' };
  }
}

/**
 * Build the API-relative serving URL for a stored asset, or `null` when unset.
 * The path is stable per kind (so the client can link it directly); a short
 * key-derived `?v=` busts browser/CDN caches whenever the asset is replaced.
 */
function buildAssetUrl(kind: BrandingAssetKind, key: string | null): string | null {
  if (!key) return null;
  const version = createHash('sha1').update(key).digest('hex').slice(0, 12);
  return `/api/branding/asset/${kind}?v=${version}`;
}
