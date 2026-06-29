import { IsOptional, IsString } from 'class-validator';

/**
 * Branding update payload (`PUT /branding`).
 *
 * Only declares the shape so the global whitelist pipe keeps these fields;
 * the *semantic* validation (hex color format, font-key catalog membership)
 * lives in {@link BrandingService} so each rejection carries its own Toss-tone
 * message rather than a generic validation array.
 */
export class UpdateBrandingDto {
  /** Brand main color as a hex string (`#RRGGBB` / `#RGB`). */
  @IsOptional()
  @IsString()
  brandColor?: string;

  /** Brand font — must be a key in the server-side catalog. */
  @IsOptional()
  @IsString()
  brandFont?: string;
}
