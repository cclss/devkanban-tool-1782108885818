import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { BrandingService } from './branding.service';
import { MESSAGES } from '../common/messages';
import { MAX_IMAGE_BYTES, type UploadedImage } from './image-validation';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngFile(): UploadedImage {
  const buffer = Buffer.concat([PNG_HEADER, Buffer.from('bytes')]);
  return { originalname: 'logo.png', mimetype: 'image/png', size: buffer.length, buffer };
}

describe('BrandingService', () => {
  let prisma: {
    brandingSettings: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let storage: {
    buildBrandingKey: jest.Mock;
    save: jest.Mock;
    openStream: jest.Mock;
  };
  let service: BrandingService;

  beforeEach(() => {
    prisma = {
      brandingSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    storage = {
      buildBrandingKey: jest.fn().mockReturnValue('branding/logo/uuid-logo.png'),
      save: jest.fn().mockResolvedValue(undefined),
      openStream: jest.fn(),
    };
    service = new BrandingService(prisma as never, storage as never);
  });

  describe('get', () => {
    it('returns null URLs when nothing is set', async () => {
      prisma.brandingSettings.findUnique.mockResolvedValue(null);
      expect(await service.get()).toEqual({ logoUrl: null, faviconUrl: null, brandColor: null });
    });

    it('builds versioned serving URLs for stored assets', async () => {
      prisma.brandingSettings.findUnique.mockResolvedValue({
        logoStorageKey: 'branding/logo/abc.png',
        faviconStorageKey: null,
        brandColor: '#163AF2',
      });
      const result = await service.get();
      expect(result.brandColor).toBe('#163AF2');
      expect(result.faviconUrl).toBeNull();
      expect(result.logoUrl).toMatch(/^\/api\/branding\/asset\/logo\?v=[0-9a-f]{12}$/);
    });
  });

  describe('saveAsset', () => {
    it('persists bytes with the detected Content-Type and upserts the row', async () => {
      prisma.brandingSettings.upsert.mockResolvedValue({});
      prisma.brandingSettings.findUnique.mockResolvedValue({
        logoStorageKey: 'branding/logo/uuid-logo.png',
        brandColor: null,
      });

      await service.saveAsset('logo', pngFile());

      expect(storage.save).toHaveBeenCalledWith(
        'branding/logo/uuid-logo.png',
        expect.any(Buffer),
        'image/png',
      );
      expect(prisma.brandingSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'GLOBAL' },
          update: { logoStorageKey: 'branding/logo/uuid-logo.png', logoContentType: 'image/png' },
        }),
      );
    });

    it('rejects an over-limit file with Toss-tone copy and never touches storage', async () => {
      const tooBig: UploadedImage = { ...pngFile(), size: MAX_IMAGE_BYTES + 1 };
      await expect(service.saveAsset('logo', tooBig)).rejects.toThrow(BadRequestException);
      await expect(service.saveAsset('logo', tooBig)).rejects.toThrow(MESSAGES.branding.fileTooLarge);
      expect(storage.save).not.toHaveBeenCalled();
      expect(prisma.brandingSettings.upsert).not.toHaveBeenCalled();
    });

    it('rejects a non-SVG/PNG file with the format message', async () => {
      const jpeg: UploadedImage = {
        originalname: 'p.jpg',
        mimetype: 'image/jpeg',
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
        size: 3,
      };
      await expect(service.saveAsset('favicon', jpeg)).rejects.toThrow(MESSAGES.branding.invalidType);
      expect(storage.save).not.toHaveBeenCalled();
    });
  });

  describe('openAsset', () => {
    it('streams stored bytes with the saved Content-Type', async () => {
      const stream = Readable.from(Buffer.from('svg'));
      prisma.brandingSettings.findUnique.mockResolvedValue({
        faviconStorageKey: 'branding/favicon/x.svg',
        faviconContentType: 'image/svg+xml',
      });
      storage.openStream.mockResolvedValue(stream);

      const result = await service.openAsset('favicon');
      expect(storage.openStream).toHaveBeenCalledWith('branding/favicon/x.svg');
      expect(result).toEqual({ stream, contentType: 'image/svg+xml' });
    });

    it('throws 404 when the asset is unset', async () => {
      prisma.brandingSettings.findUnique.mockResolvedValue({ logoStorageKey: null });
      await expect(service.openAsset('logo')).rejects.toThrow(NotFoundException);
      await expect(service.openAsset('logo')).rejects.toThrow(MESSAGES.branding.assetNotFound);
    });
  });

  describe('updateColor', () => {
    it('upserts the brand color and returns the fresh view', async () => {
      prisma.brandingSettings.upsert.mockResolvedValue({});
      prisma.brandingSettings.findUnique.mockResolvedValue({ brandColor: '#fff' });
      const result = await service.updateColor('#fff');
      expect(prisma.brandingSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'GLOBAL' }, update: { brandColor: '#fff' } }),
      );
      expect(result.brandColor).toBe('#fff');
    });
  });
});
