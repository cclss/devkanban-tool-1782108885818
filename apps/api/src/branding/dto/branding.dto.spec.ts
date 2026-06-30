import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BrandFont } from '@repo/db';
import { HEX_COLOR, UpdateBrandingDto } from './branding.dto';
import { MESSAGES } from '../../common/messages';

async function errorsFor(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateBrandingDto, payload);
  return validate(dto, { whitelist: true });
}

describe('UpdateBrandingDto', () => {
  it('uses the same hex rule as the web branding bridge', () => {
    expect(HEX_COLOR.source).toBe('^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');
  });

  it('accepts a #rrggbb color and a whitelisted font', async () => {
    await expect(errorsFor({ brandColor: '#4F46E5', brandFont: BrandFont.SANS })).resolves.toHaveLength(0);
  });

  it('accepts shorthand #rgb', async () => {
    await expect(errorsFor({ brandColor: '#abc' })).resolves.toHaveLength(0);
  });

  it('accepts an empty body (no fields to change)', async () => {
    await expect(errorsFor({})).resolves.toHaveLength(0);
  });

  it('rejects a non-hex color with the branding copy', async () => {
    const errors = await errorsFor({ brandColor: 'rebeccapurple' });
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toContain(MESSAGES.branding.invalidColor);
  });

  it('rejects a non-hex notation (rgb())', async () => {
    const errors = await errorsFor({ brandColor: 'rgb(0,0,0)' });
    expect(errors).toHaveLength(1);
  });

  it('rejects a font outside the enum whitelist with the branding copy', async () => {
    const errors = await errorsFor({ brandFont: 'COMIC_SANS' });
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toContain(MESSAGES.branding.invalidFont);
  });
});
