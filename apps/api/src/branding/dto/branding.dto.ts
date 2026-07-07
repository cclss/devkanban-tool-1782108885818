import { IsString, Matches } from 'class-validator';
import { MESSAGES } from '../../common/messages';

/**
 * Accepts `#rgb` / `#rrggbb` hex only — the same shape the web brand-color
 * picker enforces (`isValidHex` in `apps/web/src/lib/branding.ts`) and that
 * `brandStyle()` expands into the `--brand-primary` token set. Keeping the two
 * regexes aligned means a color the client accepts the server also accepts.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export class UpdateBrandingDto {
  @IsString({ message: MESSAGES.branding.invalidColor })
  @Matches(HEX_COLOR, { message: MESSAGES.branding.invalidColor })
  brandColor!: string;
}
