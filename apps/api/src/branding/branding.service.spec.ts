import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Plan } from '@repo/db';
import sharp from 'sharp';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_BRAND_FONT_KEY } from './branding.constants';
import { BrandingService, logoKeyFromUrl } from './branding.service';
import { MAX_LOGO_BYTES, RECOMMENDED_LOGO_MAX_DIM } from './branding.validation';
import { MESSAGES } from '../common/messages';

interface UserRow {
  id: string;
  plan: Plan;
  brandColor: string | null;
  brandFont: string | null;
  brandLogoUrl: string | null;
}

interface Harness {
  service: BrandingService;
  storage: StorageService;
  user: UserRow;
  dir: string;
}

async function makeHarness(overrides: Partial<UserRow> = {}): Promise<Harness> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'branding-svc-'));
  const config = {
    get: (key: string) => (key === 'STORAGE_DIR' ? dir : undefined),
  } as unknown as ConfigService;
  const storage = new StorageService(config);

  const user: UserRow = {
    id: 'user_1',
    plan: Plan.TEAM,
    brandColor: null,
    brandFont: null,
    brandLogoUrl: null,
    ...overrides,
  };

  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({ ...user })),
      update: jest.fn(async ({ data }: { data: Partial<UserRow> }) => {
        Object.assign(user, data);
        return { ...user };
      }),
    },
  } as unknown as PrismaService;

  return { service: new BrandingService(prisma, storage), storage, user, dir };
}

const SVG_BYTES = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40"/></svg>',
);

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

describe('BrandingService.getBranding', () => {
  it('returns defaults + entitlement when nothing is set', async () => {
    const h = await makeHarness();
    const view = await h.service.getBranding('user_1');
    expect(view.brandColor).toBeNull();
    expect(view.brandFont).toBe(DEFAULT_BRAND_FONT_KEY);
    expect(view.brandLogoUrl).toBeNull();
    expect(view.entitlement).toEqual({ plan: Plan.TEAM, canUseBranding: true });
    expect(view.fonts.length).toBeGreaterThan(0);
    await fs.rm(h.dir, { recursive: true, force: true });
  });

  it('reflects stored values', async () => {
    const h = await makeHarness({ brandColor: '#112233', brandFont: 'noto-sans-kr' });
    const view = await h.service.getBranding('user_1');
    expect(view.brandColor).toBe('#112233');
    expect(view.brandFont).toBe('noto-sans-kr');
    await fs.rm(h.dir, { recursive: true, force: true });
  });
});

describe('BrandingService.updateBranding', () => {
  it('persists a valid hex color and catalog font', async () => {
    const h = await makeHarness();
    const view = await h.service.updateBranding('user_1', {
      brandColor: '#0050FF',
      brandFont: 'nanum-gothic',
    });
    expect(view.brandColor).toBe('#0050FF');
    expect(view.brandFont).toBe('nanum-gothic');
    await fs.rm(h.dir, { recursive: true, force: true });
  });

  it('rejects a non-hex color', async () => {
    const h = await makeHarness();
    await expect(
      h.service.updateBranding('user_1', { brandColor: 'red' }),
    ).rejects.toThrow(MESSAGES.branding.invalidColor);
    await fs.rm(h.dir, { recursive: true, force: true });
  });

  it('rejects an unregistered font key', async () => {
    const h = await makeHarness();
    await expect(
      h.service.updateBranding('user_1', { brandFont: 'comic-sans' }),
    ).rejects.toThrow(MESSAGES.branding.invalidFont);
    await fs.rm(h.dir, { recursive: true, force: true });
  });

  it('updates only the provided field', async () => {
    const h = await makeHarness({ brandColor: '#abcdef', brandFont: 'pretendard' });
    const view = await h.service.updateBranding('user_1', { brandFont: 'gowun-dodum' });
    expect(view.brandColor).toBe('#abcdef');
    expect(view.brandFont).toBe('gowun-dodum');
    await fs.rm(h.dir, { recursive: true, force: true });
  });
});

describe('BrandingService.uploadLogo', () => {
  it('rejects an empty file', async () => {
    const h = await makeHarness();
    await expect(
      h.service.uploadLogo('user_1', { buffer: Buffer.alloc(0), size: 0 }),
    ).rejects.toThrow(MESSAGES.branding.logoEmpty);
    await fs.rm(h.dir, { recursive: true, force: true });
  });

  it('rejects files over 2MB', async () => {
    const h = await makeHarness();
    const big = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(MAX_LOGO_BYTES + 1),
    ]);
    await expect(
      h.service.uploadLogo('user_1', {
        originalname: 'big.png',
        mimetype: 'image/png',
        buffer: big,
        size: big.length,
      }),
    ).rejects.toThrow(MESSAGES.branding.logoTooLarge);
    await fs.rm(h.dir, { recursive: true, force: true });
  });

  it('rejects a forged MIME / extension (non-image content)', async () => {
    const h = await makeHarness();
    const fake = Buffer.from('MZ this is not an image');
    await expect(
      h.service.uploadLogo('user_1', {
        originalname: 'evil.png',
        mimetype: 'image/png',
        buffer: fake,
        size: fake.length,
      }),
    ).rejects.toThrow(MESSAGES.branding.logoInvalidType);
    await fs.rm(h.dir, { recursive: true, force: true });
  });

  it('rejects a real PNG renamed to .svg (content/extension mismatch)', async () => {
    const h = await makeHarness();
    const png = await makePng(64, 64);
    await expect(
      h.service.uploadLogo('user_1', {
        originalname: 'logo.svg',
        mimetype: 'image/svg+xml',
        buffer: png,
        size: png.length,
      }),
    ).rejects.toThrow(MESSAGES.branding.logoInvalidType);
    await fs.rm(h.dir, { recursive: true, force: true });
  });

  it('accepts a valid PNG, downscales it, stores under branding/, and returns a servable URL', async () => {
    const h = await makeHarness();
    const png = await makePng(1000, 400); // larger than the recommended box
    const view = await h.service.uploadLogo('user_1', {
      originalname: 'logo.png',
      mimetype: 'image/png',
      buffer: png,
      size: png.length,
    });

    expect(view.brandLogoUrl).toMatch(
      /^\/api\/branding\/logo\/file\?key=branding%2Fuser_1%2Flogo-/,
    );
    const key = logoKeyFromUrl(view.brandLogoUrl as string)!;
    expect(key.startsWith('branding/user_1/')).toBe(true);
    expect(key.endsWith('.png')).toBe(true);

    // bytes are actually stored and downscaled within the recommended box
    const stored = await h.storage.read(key);
    const meta = await sharp(stored).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(
      RECOMMENDED_LOGO_MAX_DIM,
    );
    expect(h.storage.contentTypeForKey(key)).toBe('image/png');
    await fs.rm(h.dir, { recursive: true, force: true });
  });

  it('accepts an SVG and stores the original bytes verbatim', async () => {
    const h = await makeHarness();
    const view = await h.service.uploadLogo('user_1', {
      originalname: 'logo.svg',
      mimetype: 'image/svg+xml',
      buffer: SVG_BYTES,
      size: SVG_BYTES.length,
    });
    const key = logoKeyFromUrl(view.brandLogoUrl as string)!;
    expect(key.endsWith('.svg')).toBe(true);
    const stored = await h.storage.read(key);
    expect(stored.equals(SVG_BYTES)).toBe(true); // verbatim, no re-encode
    await fs.rm(h.dir, { recursive: true, force: true });
  });

  it('removes the previous logo file when a new one replaces it', async () => {
    const h = await makeHarness();
    const first = await h.service.uploadLogo('user_1', {
      originalname: 'a.svg',
      mimetype: 'image/svg+xml',
      buffer: SVG_BYTES,
      size: SVG_BYTES.length,
    });
    const firstKey = logoKeyFromUrl(first.brandLogoUrl as string)!;

    await h.service.uploadLogo('user_1', {
      originalname: 'b.svg',
      mimetype: 'image/svg+xml',
      buffer: SVG_BYTES,
      size: SVG_BYTES.length,
    });

    await expect(h.storage.read(firstKey)).rejects.toBeDefined(); // old blob gone
    await fs.rm(h.dir, { recursive: true, force: true });
  });
});

describe('BrandingService.deleteLogo', () => {
  it('removes the logo and clears the URL (idempotent when none)', async () => {
    const h = await makeHarness();
    const uploaded = await h.service.uploadLogo('user_1', {
      originalname: 'logo.svg',
      mimetype: 'image/svg+xml',
      buffer: SVG_BYTES,
      size: SVG_BYTES.length,
    });
    const key = logoKeyFromUrl(uploaded.brandLogoUrl as string)!;

    const afterDelete = await h.service.deleteLogo('user_1');
    expect(afterDelete.brandLogoUrl).toBeNull();
    await expect(h.storage.read(key)).rejects.toBeDefined();

    // second delete is a no-op, not an error
    const again = await h.service.deleteLogo('user_1');
    expect(again.brandLogoUrl).toBeNull();
    await fs.rm(h.dir, { recursive: true, force: true });
  });
});

describe('BrandingService.resolveLogoKey', () => {
  it('accepts branding/ keys and rejects traversal or foreign namespaces', async () => {
    const h = await makeHarness();
    expect(h.service.resolveLogoKey('branding/user_1/logo-x.png')).toBe(
      'branding/user_1/logo-x.png',
    );
    expect(() => h.service.resolveLogoKey('documents/user_1/secret.pdf')).toThrow(
      BadRequestException,
    );
    expect(() => h.service.resolveLogoKey('branding/../documents/x.pdf')).toThrow(
      BadRequestException,
    );
    expect(() => h.service.resolveLogoKey(undefined)).toThrow(BadRequestException);
    await fs.rm(h.dir, { recursive: true, force: true });
  });
});

describe('logoKeyFromUrl', () => {
  it('extracts the key, or null when absent', () => {
    expect(logoKeyFromUrl('/api/branding/logo/file?key=branding%2Fu%2Flogo.png')).toBe(
      'branding/u/logo.png',
    );
    expect(logoKeyFromUrl('/some/other/url')).toBeNull();
  });
});
