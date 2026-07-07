import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Readable } from 'stream';
import request from 'supertest';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MESSAGES } from '../common/messages';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * HTTP-level checks over the real Nest pipeline (routing, FileInterceptor's 1MB
 * limit + the Multer→Toss-copy filter, ValidationPipe, streaming). The service
 * is mocked so the focus is the controller wiring.
 */
describe('BrandingController (HTTP)', () => {
  let app: INestApplication;
  const branding = {
    saveAsset: jest.fn(),
    updateColor: jest.fn(),
    get: jest.fn(),
    openAsset: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BrandingController],
      providers: [{ provide: BrandingService, useValue: branding }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('POST /api/branding/logo persists an upload and returns the branding view', async () => {
    branding.saveAsset.mockResolvedValue({ logoUrl: '/api/branding/asset/logo?v=abc', faviconUrl: null, brandColor: null });
    const png = Buffer.concat([PNG_HEADER, Buffer.from('bytes')]);

    const res = await request(app.getHttpServer())
      .post('/api/branding/logo')
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.logoUrl).toBe('/api/branding/asset/logo?v=abc');
    expect(branding.saveAsset).toHaveBeenCalledWith('logo', expect.objectContaining({ mimetype: 'image/png' }));
  });

  it('rejects an over-1MB upload with the Toss-tone "too large" copy', async () => {
    const tooBig = Buffer.concat([PNG_HEADER, Buffer.alloc(1024 * 1024)]); // >1MB
    const res = await request(app.getHttpServer())
      .post('/api/branding/favicon')
      .attach('file', tooBig, { filename: 'big.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(MESSAGES.branding.fileTooLarge);
    expect(branding.saveAsset).not.toHaveBeenCalled();
  });

  it('PATCH /api/branding rejects a non-hex color with hint copy', async () => {
    const res = await request(app.getHttpServer()).patch('/api/branding').send({ brandColor: 'blue' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(MESSAGES.branding.invalidColor);
    expect(branding.updateColor).not.toHaveBeenCalled();
  });

  it('PATCH /api/branding accepts a valid hex color', async () => {
    branding.updateColor.mockResolvedValue({ logoUrl: null, faviconUrl: null, brandColor: '#163AF2' });
    const res = await request(app.getHttpServer()).patch('/api/branding').send({ brandColor: '#163AF2' });
    expect(res.status).toBe(200);
    expect(branding.updateColor).toHaveBeenCalledWith('#163AF2');
  });

  it('GET /api/branding returns the public view (no auth)', async () => {
    branding.get.mockResolvedValue({ logoUrl: '/api/branding/asset/logo?v=v1', faviconUrl: null, brandColor: '#163AF2' });
    const res = await request(app.getHttpServer()).get('/api/branding');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ logoUrl: '/api/branding/asset/logo?v=v1', faviconUrl: null, brandColor: '#163AF2' });
  });

  it('GET /api/branding/asset/logo streams bytes with the stored MIME + cache header', async () => {
    branding.openAsset.mockResolvedValue({ stream: Readable.from(Buffer.from('<svg/>')), contentType: 'image/svg+xml' });
    const res = await request(app.getHttpServer()).get('/api/branding/asset/logo').buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(Buffer.from(res.body).toString()).toBe('<svg/>');
    expect(branding.openAsset).toHaveBeenCalledWith('logo');
  });

  it('GET /api/branding/asset/:kind 404s for an unknown kind', async () => {
    const res = await request(app.getHttpServer()).get('/api/branding/asset/banner');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe(MESSAGES.branding.assetNotFound);
    expect(branding.openAsset).not.toHaveBeenCalled();
  });
});
