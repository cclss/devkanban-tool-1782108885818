import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SignFieldTypeDto, type SignFieldDto } from './dto/documents.dto';

/**
 * HTTP-level checks over the real Nest pipeline (routing, class-level
 * JwtAuthGuard, ValidationPipe). The service is mocked so the focus is the
 * `POST /documents/:id/field-suggestions` controller wiring: route
 * registration, the auth guard, and the array pass-through. `CurrentUser` reads
 * `req.user`, which the stub guard attaches, so the owner id reaches the
 * service unchanged.
 */
describe('DocumentsController — field-suggestions (HTTP)', () => {
  let app: INestApplication;
  const documents = { suggestFields: jest.fn() };
  const storage = {};
  // The stub guard both authenticates and injects the current user; flip
  // `authed` per-test to exercise the guard rejecting an unauthenticated call.
  let authed = true;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        { provide: DocumentsService, useValue: documents },
        { provide: StorageService, useValue: storage },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!authed) return false;
          ctx.switchToHttp().getRequest().user = { id: 'owner-1' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authed = true;
  });

  it('returns 200 + SignFieldDto[] for the authenticated owner, delegating to the service', async () => {
    const suggestions: SignFieldDto[] = [
      { type: SignFieldTypeDto.SIGNATURE, page: 1, x: 0.1, y: 0.2, width: 0.2, height: 0.05, recipientIndex: 0 },
    ];
    documents.suggestFields.mockResolvedValue(suggestions);

    const res = await request(app.getHttpServer()).post('/api/documents/doc-1/field-suggestions');

    // POST defaults to 201; @HttpCode(OK) pins it to 200 like the send/save routes.
    expect(res.status).toBe(200);
    expect(res.body).toEqual(suggestions);
    expect(documents.suggestFields).toHaveBeenCalledWith('owner-1', 'doc-1');
  });

  it('returns 200 + [] when auto-placement is not possible (empty-array fallback)', async () => {
    documents.suggestFields.mockResolvedValue([]);

    const res = await request(app.getHttpServer()).post('/api/documents/doc-1/field-suggestions');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(documents.suggestFields).toHaveBeenCalledWith('owner-1', 'doc-1');
  });

  it('is blocked by the auth guard when unauthenticated (service never called)', async () => {
    authed = false;

    const res = await request(app.getHttpServer()).post('/api/documents/doc-1/field-suggestions');

    expect(res.status).toBe(403);
    expect(documents.suggestFields).not.toHaveBeenCalled();
  });
});
