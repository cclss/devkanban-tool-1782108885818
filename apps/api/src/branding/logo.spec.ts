import {
  contentTypeForBytes,
  detectLogoFormat,
  sanitizeSvg,
  type UploadedLogo,
} from './logo';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

function file(buffer: Buffer, originalname: string, mimetype: string): UploadedLogo {
  return { buffer, originalname, mimetype, size: buffer.length };
}

describe('detectLogoFormat', () => {
  it('accepts PNG when mime, extension, and magic agree', () => {
    expect(detectLogoFormat(file(PNG, 'logo.png', 'image/png'))).toBe('png');
  });

  it('accepts JPEG (both jpg/jpeg extensions and image/jpeg)', () => {
    expect(detectLogoFormat(file(JPEG, 'logo.jpg', 'image/jpeg'))).toBe('jpeg');
    expect(detectLogoFormat(file(JPEG, 'logo.jpeg', 'image/jpeg'))).toBe('jpeg');
  });

  it('accepts SVG with an <svg root', () => {
    expect(detectLogoFormat(file(SVG, 'logo.svg', 'image/svg+xml'))).toBe('svg');
  });

  it('tolerates a charset parameter on the svg mime', () => {
    expect(detectLogoFormat(file(SVG, 'logo.svg', 'image/svg+xml; charset=utf-8'))).toBe('svg');
  });

  it('rejects a disallowed format (gif)', () => {
    expect(detectLogoFormat(file(Buffer.from('GIF89a'), 'logo.gif', 'image/gif'))).toBeNull();
  });

  it('rejects when mime and extension disagree', () => {
    expect(detectLogoFormat(file(PNG, 'logo.svg', 'image/png'))).toBeNull();
  });

  it('rejects a content/extension mismatch (script bytes renamed .png)', () => {
    const evil = file(Buffer.from('<script>alert(1)</script>'), 'logo.png', 'image/png');
    expect(detectLogoFormat(evil)).toBeNull();
  });

  it('rejects an empty buffer', () => {
    expect(detectLogoFormat(file(Buffer.alloc(0), 'logo.png', 'image/png'))).toBeNull();
  });
});

describe('contentTypeForBytes', () => {
  it('sniffs png/jpeg/svg back to their content types', () => {
    expect(contentTypeForBytes(PNG)).toBe('image/png');
    expect(contentTypeForBytes(JPEG)).toBe('image/jpeg');
    expect(contentTypeForBytes(SVG)).toBe('image/svg+xml');
  });

  it('falls back to octet-stream for unknown bytes', () => {
    expect(contentTypeForBytes(Buffer.from('nope'))).toBe('application/octet-stream');
  });
});

describe('sanitizeSvg', () => {
  it('removes <script> blocks', () => {
    const out = sanitizeSvg(
      Buffer.from('<svg><script>alert(1)</script><rect/></svg>'),
    ).toString('utf8');
    expect(out).not.toMatch(/<script/i);
    expect(out).toMatch(/<rect/i);
  });

  it('strips inline event handlers', () => {
    const out = sanitizeSvg(
      Buffer.from('<svg onload="alert(1)"><rect onclick="x()"/></svg>'),
    ).toString('utf8');
    expect(out).not.toMatch(/onload/i);
    expect(out).not.toMatch(/onclick/i);
  });

  it('removes <foreignObject> (HTML embedding vector)', () => {
    const out = sanitizeSvg(
      Buffer.from('<svg><foreignObject><body>hi</body></foreignObject><rect/></svg>'),
    ).toString('utf8');
    expect(out).not.toMatch(/foreignObject/i);
    expect(out).toMatch(/<rect/i);
  });

  it('drops external href/xlink:href but keeps fragment refs', () => {
    const out = sanitizeSvg(
      Buffer.from(
        '<svg><image href="http://evil.test/x.png"/><use xlink:href="#icon"/></svg>',
      ),
    ).toString('utf8');
    expect(out).not.toMatch(/evil\.test/i);
    expect(out).toMatch(/#icon/);
  });

  it('removes DOCTYPE/ENTITY (XXE / entity expansion)', () => {
    const out = sanitizeSvg(
      Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg><rect/></svg>'),
    ).toString('utf8');
    expect(out).not.toMatch(/DOCTYPE/i);
    expect(out).not.toMatch(/ENTITY/i);
  });

  it('neutralizes javascript: schemes', () => {
    const out = sanitizeSvg(
      Buffer.from('<svg><a href="javascript:alert(1)"><rect/></a></svg>'),
    ).toString('utf8');
    expect(out).not.toMatch(/javascript:/i);
  });
});
