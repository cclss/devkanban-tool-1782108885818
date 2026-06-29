import {
  AA_CONTRAST_MIN,
  BRAND_FONT_CATALOG,
  DEFAULT_BRAND_FONT_KEY,
  brandStyle,
  canUseBrandingPlan,
  contrastOnWhite,
  deleteLogo,
  fetchBranding,
  getBrandFont,
  isHexColor,
  isLowContrastOnWhite,
  resolveBrandFontFamily,
  resolveLogoSrc,
  updateBranding,
  uploadLogo,
  type BrandingView,
} from './branding';
import { ApiError } from './api';

const ORIGIN = 'http://localhost:3001';

const VIEW: BrandingView = {
  brandColor: '#1c64f2',
  brandFont: 'noto-sans-kr',
  brandLogoUrl: '/api/branding/logo/file?key=branding/u1/abc.png',
  fonts: BRAND_FONT_CATALOG,
  entitlement: { plan: 'TEAM', canUseBranding: true },
};

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('isHexColor', () => {
  it('accepts #rgb and #rrggbb (any case), trims', () => {
    expect(isHexColor('#fff')).toBe(true);
    expect(isHexColor('#1c64f2')).toBe(true);
    expect(isHexColor('  #ABC123 ')).toBe(true);
  });

  it('rejects malformed / non-hex', () => {
    expect(isHexColor('')).toBe(false);
    expect(isHexColor('1c64f2')).toBe(false);
    expect(isHexColor('#12')).toBe(false);
    expect(isHexColor('#1234')).toBe(false);
    expect(isHexColor('rgb(0,0,0)')).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });
});

describe('brandStyle', () => {
  it('emits the brand color companion set for a valid color', () => {
    const s = brandStyle('#ff5a5f');
    expect(s['--brand-primary']).toBe('#ff5a5f');
    expect(s['--brand-primary-hover']).toContain('#ff5a5f');
    expect(s['--brand-primary-pressed']).toContain('#ff5a5f');
    expect(s['--brand-primary-subtle']).toContain('#ff5a5f');
  });

  it('ignores an invalid/empty color (defaults stay in force)', () => {
    expect(brandStyle('nope')).toEqual({});
    expect(brandStyle(null)).toEqual({});
    expect(brandStyle(undefined)).toEqual({});
  });

  it('emits --brand-font resolved to the family stack when a font key is given', () => {
    const s = brandStyle('#1c64f2', 'noto-sans-kr');
    expect(s['--brand-font']).toBe(resolveBrandFontFamily('noto-sans-kr'));
    expect(s['--brand-primary']).toBe('#1c64f2');
  });

  it('stays backward compatible: single-arg call emits no font var', () => {
    const s = brandStyle('#1c64f2');
    expect('--brand-font' in s).toBe(false);
  });

  it('can emit only the font (invalid color, valid font)', () => {
    const s = brandStyle('bad', 'gowun-dodum');
    expect(s['--brand-primary']).toBeUndefined();
    expect(s['--brand-font']).toBe(resolveBrandFontFamily('gowun-dodum'));
  });
});

describe('brand font catalog', () => {
  it('resolves a known key, falls back to default for unknown/empty', () => {
    expect(getBrandFont('noto-serif-kr').key).toBe('noto-serif-kr');
    expect(getBrandFont('does-not-exist').key).toBe(DEFAULT_BRAND_FONT_KEY);
    expect(getBrandFont(null).key).toBe(DEFAULT_BRAND_FONT_KEY);
  });

  it('default key is the first catalog entry (app body font)', () => {
    expect(DEFAULT_BRAND_FONT_KEY).toBe(BRAND_FONT_CATALOG[0].key);
    expect(resolveBrandFontFamily(DEFAULT_BRAND_FONT_KEY)).toContain('Pretendard');
  });
});

describe('AA contrast on white', () => {
  it('black has maximal contrast, white minimal', () => {
    expect(contrastOnWhite('#000000')).toBeCloseTo(21, 0);
    expect(contrastOnWhite('#ffffff')).toBeCloseTo(1, 5);
  });

  it('flags a low-contrast (light) color but not a dark one', () => {
    expect(isLowContrastOnWhite('#ffeb3b')).toBe(true); // bright yellow — unreadable on white
    expect(isLowContrastOnWhite('#1f2937')).toBe(false); // ink — fine
  });

  it('does not flag invalid/empty input (the format error covers that)', () => {
    expect(isLowContrastOnWhite('')).toBe(false);
    expect(isLowContrastOnWhite('nope')).toBe(false);
    expect(isLowContrastOnWhite(null)).toBe(false);
  });

  it('the threshold is the WCAG AA normal-text minimum', () => {
    expect(AA_CONTRAST_MIN).toBe(4.5);
  });
});

describe('canUseBrandingPlan (client mirror of canUseBranding)', () => {
  it('unlocks TEAM/ENTERPRISE only', () => {
    expect(canUseBrandingPlan('TEAM')).toBe(true);
    expect(canUseBrandingPlan('ENTERPRISE')).toBe(true);
    expect(canUseBrandingPlan('FREE')).toBe(false);
    expect(canUseBrandingPlan('PRO')).toBe(false);
    expect(canUseBrandingPlan(null)).toBe(false);
    expect(canUseBrandingPlan(undefined)).toBe(false);
  });
});

describe('resolveLogoSrc', () => {
  it('absolutizes a root-relative API path against the API origin', () => {
    expect(resolveLogoSrc('/api/branding/logo/file?key=k')).toBe(
      `${ORIGIN}/api/branding/logo/file?key=k`,
    );
  });

  it('passes through absolute URLs and null', () => {
    expect(resolveLogoSrc('https://cdn.example.com/logo.png')).toBe(
      'https://cdn.example.com/logo.png',
    );
    expect(resolveLogoSrc(null)).toBeNull();
    expect(resolveLogoSrc(undefined)).toBeNull();
  });
});

describe('branding API client', () => {
  it('fetchBranding GETs /branding and returns the view', async () => {
    const fn = mockFetchOnce(VIEW);
    const v = await fetchBranding();
    expect(v).toEqual(VIEW);
    expect(fn).toHaveBeenCalledWith(`${ORIGIN}/api/branding`, expect.any(Object));
  });

  it('updateBranding PUTs the changed fields as JSON', async () => {
    const fn = mockFetchOnce(VIEW);
    await updateBranding({ brandColor: '#1c64f2', brandFont: 'noto-sans-kr' });
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe(`${ORIGIN}/api/branding`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      brandColor: '#1c64f2',
      brandFont: 'noto-sans-kr',
    });
  });

  it('deleteLogo DELETEs /branding/logo', async () => {
    const fn = mockFetchOnce({ ...VIEW, brandLogoUrl: null });
    const v = await deleteLogo();
    expect(v.brandLogoUrl).toBeNull();
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe(`${ORIGIN}/api/branding/logo`);
    expect(init.method).toBe('DELETE');
  });

  it('uploadLogo POSTs multipart form-data to /branding/logo', async () => {
    const fn = mockFetchOnce(VIEW);
    const file = new File([new Uint8Array([0x89, 0x50])], 'logo.png', { type: 'image/png' });
    const v = await uploadLogo(file);
    expect(v).toEqual(VIEW);
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe(`${ORIGIN}/api/branding/logo`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('surfaces the server Toss-tone message as an ApiError on failure', async () => {
    mockFetchOnce({ message: '브랜딩 설정은 팀 플랜부터 사용할 수 있어요.' }, { ok: false, status: 403 });
    await expect(updateBranding({ brandFont: 'noto-sans-kr' })).rejects.toMatchObject({
      status: 403,
      message: '브랜딩 설정은 팀 플랜부터 사용할 수 있어요.',
    });
  });

  it('uploadLogo maps a failed upload to an ApiError with the server status', async () => {
    mockFetchOnce({ message: 'JPG, PNG, SVG 이미지만 올릴 수 있어요.' }, { ok: false, status: 400 });
    const file = new File([new Uint8Array([1, 2, 3])], 'x.gif', { type: 'image/gif' });
    await expect(uploadLogo(file)).rejects.toBeInstanceOf(ApiError);
  });
});
