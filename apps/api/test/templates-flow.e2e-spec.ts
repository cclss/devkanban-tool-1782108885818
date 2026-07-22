/**
 * End-to-end CRUD for the reusable-template feature (grain-3):
 *   register → create → list → detail → rename → delete, all owner-scoped,
 *   plus ownership isolation and the per-plan template cap.
 */

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://hermes@localhost/esign_test?host=/var/run/postgresql&schema=public';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'e2e-test-secret';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Templates flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;

  const email = `tmpl_${Date.now()}@example.com`;
  const password = 'password1234';

  const sampleFields = [
    { type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, recipientIndex: 0 },
    { type: 'DATE', page: 1, x: 0.5, y: 0.2, width: 0.2, height: 0.05, recipientIndex: 1 },
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: '템플릿테스터' })
      .expect(201);
    token = res.body.accessToken;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await app.close();
  });

  it('blocks unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/api/templates').expect(401);
  });

  let templateId: string;

  it('creates a template with a saved field layout', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '표준 근로계약서',
        storageKey: `templates/${userId}/std.pdf`,
        pageCount: 3,
        fields: sampleFields,
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('표준 근로계약서');
    expect(res.body.pageCount).toBe(3);
    expect(res.body.fieldCount).toBe(2);
    expect(res.body.fields).toHaveLength(2);
    expect(res.body.fields[0]).toMatchObject({ type: 'SIGNATURE', recipientIndex: 0 });
    templateId = res.body.id;
  });

  it('lists the owner templates (newest first, no field layout)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const found = res.body.find((t: { id: string }) => t.id === templateId);
    expect(found).toBeDefined();
    expect(found.fieldCount).toBe(2);
    expect(found.fields).toBeUndefined();
  });

  it('fetches a single template incl. its fields and storage key', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.storageKey).toBe(`templates/${userId}/std.pdf`);
    expect(res.body.fields).toHaveLength(2);
  });

  it('renames a template', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '수정된 계약서' })
      .expect(200);
    expect(res.body.name).toBe('수정된 계약서');
  });

  it('returns a Korean 404 for a missing template', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/templates/nonexistent-id')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(res.body.message).toBe('요청한 템플릿을 찾을 수 없어요.');
  });

  it("forbids access to another owner's template", async () => {
    const other = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `other_${Date.now()}@example.com`, password, name: '다른사람' })
      .expect(201);
    const otherToken = other.body.accessToken;
    const otherId = other.body.user.id;

    const res = await request(app.getHttpServer())
      .get(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    expect(res.body.message).toBe('이 템플릿에 접근할 권한이 없어요.');

    await prisma.user.delete({ where: { id: otherId } }).catch(() => undefined);
  });

  it('enforces the Free-plan template cap with a Korean message', async () => {
    // The Free cap is 3; one template already exists, so seed two more to reach it.
    for (let i = 0; i < 2; i += 1) {
      await request(app.getHttpServer())
        .post('/api/templates')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `추가 ${i}`, storageKey: `templates/${userId}/x${i}.pdf`, fields: [] })
        .expect(201);
    }
    const res = await request(app.getHttpServer())
      .post('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '초과', storageKey: `templates/${userId}/over.pdf`, fields: [] })
      .expect(403);
    expect(res.body.message).toBe(
      '저장할 수 있는 템플릿 수를 모두 채웠어요. 기존 템플릿을 지우거나 플랜을 업그레이드해 주세요.',
    );
  });

  it('deletes a template (204) and it disappears from the list', async () => {
    await request(app.getHttpServer())
      .delete(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
