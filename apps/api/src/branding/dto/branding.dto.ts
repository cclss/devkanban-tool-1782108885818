import { BrandFont } from '@repo/db';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import { MESSAGES } from '../../common/messages';

/**
 * Accepts `#rgb` / `#rrggbb` only — identical rule to the web bridge's
 * `HEX_COLOR` (`apps/web/src/lib/branding.ts`), which expands this single color
 * into the `--brand-*` custom-property set. Keeping the regex byte-for-byte
 * identical guarantees anything we persist re-skins cleanly on the signer side.
 */
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Update the sender's branding. Logo upload is a separate grain, so only the
 * brand color and signer-screen font are mutable here. Both fields are optional
 * (a sender may set one without the other); `null` clears a field back to the
 * default tokens.
 */
export class UpdateBrandingDto {
  @IsOptional()
  @Matches(HEX_COLOR, { message: MESSAGES.branding.invalidColor })
  brandColor?: string | null;

  @IsOptional()
  @IsEnum(BrandFont, { message: MESSAGES.branding.invalidFont })
  brandFont?: BrandFont | null;
}
