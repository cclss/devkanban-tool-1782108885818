import {
  detectLogoType,
  isHexColor,
  logoTypeFromExtension,
  logoTypeFromMime,
  looksLikeSvg,
  MAX_LOGO_BYTES,
  resolveLogoType,
} from './branding.validation';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
const SVG_BARE = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

describe('isHexColor', () => {
  it('accepts #RRGGBB and #RGB, any case', () => {
    expect(isHexColor('#1a2b3c')).toBe(true);
    expect(isHexColor('#ABC')).toBe(true);
    expect(isHexColor('#0050FF')).toBe(true);
  });

  it('rejects non-hex, missing #, wrong length, and non-strings', () => {
    expect(isHexColor('1a2b3c')).toBe(false);
    expect(isHexColor('#12')).toBe(false);
    expect(isHexColor('#1234')).toBe(false);
    expect(isHexColor('#gggggg')).toBe(false);
    expect(isHexColor('rgb(0,0,0)')).toBe(false);
    expect(isHexColor(123 as unknown)).toBe(false);
    expect(isHexColor(null as unknown)).toBe(false);
  });
});

describe('detectLogoType (magic bytes)', () => {
  it('detects png/jpeg/svg by content', () => {
    expect(detectLogoType(PNG)).toBe('png');
    expect(detectLogoType(JPEG)).toBe('jpeg');
    expect(detectLogoType(SVG)).toBe('svg');
    expect(detectLogoType(SVG_BARE)).toBe('svg');
  });

  it('returns null for non-image content', () => {
    expect(detectLogoType(Buffer.from('MZ\x90\x00arbitrary-binary'))).toBeNull();
    expect(detectLogoType(Buffer.from('just text'))).toBeNull();
    expect(detectLogoType(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});

describe('looksLikeSvg', () => {
  it('accepts xml-prefixed and bare svg roots', () => {
    expect(looksLikeSvg(SVG)).toBe(true);
    expect(looksLikeSvg(SVG_BARE)).toBe(true);
  });

  it('rejects html and scripted svg (XSS defense)', () => {
    expect(looksLikeSvg(Buffer.from('<html><body></body></html>'))).toBe(false);
    expect(
      looksLikeSvg(Buffer.from('<svg xmlns="..."><script>alert(1)</script></svg>')),
    ).toBe(false);
  });
});

describe('logoTypeFrom* mappings', () => {
  it('maps extensions', () => {
    expect(logoTypeFromExtension('a.png')).toBe('png');
    expect(logoTypeFromExtension('a.JPG')).toBe('jpeg');
    expect(logoTypeFromExtension('a.jpeg')).toBe('jpeg');
    expect(logoTypeFromExtension('a.svg')).toBe('svg');
    expect(logoTypeFromExtension('a.gif')).toBeNull();
    expect(logoTypeFromExtension('noext')).toBeNull();
  });

  it('maps MIME types and ignores unknown', () => {
    expect(logoTypeFromMime('image/png')).toBe('png');
    expect(logoTypeFromMime('image/jpeg')).toBe('jpeg');
    expect(logoTypeFromMime('image/svg+xml')).toBe('svg');
    expect(logoTypeFromMime('application/octet-stream')).toBeNull();
    expect(logoTypeFromMime(undefined)).toBeNull();
  });
});

describe('resolveLogoType (anti-spoofing)', () => {
  it('accepts when content, extension, and MIME all agree', () => {
    expect(
      resolveLogoType({ originalname: 'logo.png', mimetype: 'image/png', buffer: PNG }),
    ).toBe('png');
  });

  it('accepts when extension/MIME are absent or unrecognized but content is valid', () => {
    expect(resolveLogoType({ buffer: JPEG })).toBe('jpeg');
    expect(
      resolveLogoType({ originalname: 'logo', mimetype: 'application/octet-stream', buffer: PNG }),
    ).toBe('png');
  });

  it('rejects a non-image disguised by extension+MIME', () => {
    expect(
      resolveLogoType({
        originalname: 'evil.png',
        mimetype: 'image/png',
        buffer: Buffer.from('MZ executable'),
      }),
    ).toBeNull();
  });

  it('rejects when the extension contradicts real content (renamed file)', () => {
    expect(
      resolveLogoType({ originalname: 'logo.svg', mimetype: 'image/svg+xml', buffer: PNG }),
    ).toBeNull();
  });

  it('rejects when the declared MIME contradicts real content (forged MIME)', () => {
    expect(
      resolveLogoType({ originalname: 'logo.svg', mimetype: 'image/png', buffer: SVG }),
    ).toBeNull();
  });
});

it('caps logo size at 2MB', () => {
  expect(MAX_LOGO_BYTES).toBe(2 * 1024 * 1024);
});
