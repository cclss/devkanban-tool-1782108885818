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
import { StorageService } from '../src/storage/storage.service';

/** Smallest valid-ish PDF payload; enough to assert bytes stream back. */
const SAMPLE_PDF = Buffer.from('%PDF-1.4\n%stub template pdf\n%%EOF\n');

describe('Templates flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
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
    storage = app.get(StorageService);

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

  it('rejects a missing template name (400) and saves nothing', async () => {
    const before = await prisma.template.count({ where: { ownerId: userId } });

    await request(app.getHttpServer())
      .post('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ storageKey: `templates/${userId}/noname.pdf`, fields: sampleFields })
      .expect(400);

    const after = await prisma.template.count({ where: { ownerId: userId } });
    expect(after).toBe(before);
  });

  it('rejects a whitespace-only template name (400) and saves nothing', async () => {
    const before = await prisma.template.count({ where: { ownerId: userId } });

    await request(app.getHttpServer())
      .post('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ', storageKey: `templates/${userId}/blank.pdf`, fields: sampleFields })
      .expect(400);

    const after = await prisma.template.count({ where: { ownerId: userId } });
    expect(after).toBe(before);
  });

  it('strips recipient info and contract-specific values from a create payload (M-2)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '스키마 외 값 주입 템플릿',
        storageKey: `templates/${userId}/extra.pdf`,
        pageCount: 1,
        fields: sampleFields,
        // Schema-external fields that mimic an in-flight send: recipient
        // identity/order and a contract-specific dollar amount. None of
        // these belong on CreateTemplateDto, so the whitelist ValidationPipe
        // must strip them before they ever reach the service/DB.
        recipients: [{ name: '홍길동', email: 'hong@example.com', order: 0 }],
        recipientName: '홍길동',
        recipientEmail: 'hong@example.com',
        signingOrder: 1,
        contractAmount: 1_000_000,
        contractValue: 1_000_000,
      })
      .expect(201);

    // Note: `recipientIndex` is a legitimate per-field property on
    // SignFieldDto (which recipient slot a field belongs to) and IS expected
    // to appear in the response — so assertions below target the specific
    // injected keys/values (recipients, recipientName/Email, signingOrder,
    // contractAmount/Value, the injected name/email) rather than the
    // substring "recipient", which would false-positive on recipientIndex.
    const injectedId: string = res.body.id;
    expect(res.body).not.toHaveProperty('recipients');
    expect(res.body).not.toHaveProperty('recipientName');
    expect(res.body).not.toHaveProperty('recipientEmail');
    expect(res.body).not.toHaveProperty('signingOrder');
    expect(res.body).not.toHaveProperty('contractAmount');
    expect(res.body).not.toHaveProperty('contractValue');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('signingOrder');
    expect(serialized).not.toContain('contractAmount');
    expect(serialized).not.toContain('contractValue');
    expect(serialized).not.toContain('홍길동');
    expect(serialized).not.toContain('hong@example.com');

    const stored = await prisma.template.findUnique({ where: { id: injectedId } });
    const storedSerialized = JSON.stringify(stored);
    expect(storedSerialized).not.toContain('signingOrder');
    expect(storedSerialized).not.toContain('contractAmount');
    expect(storedSerialized).not.toContain('contractValue');
    expect(storedSerialized).not.toContain('홍길동');
    expect(storedSerialized).not.toContain('hong@example.com');

    const detail = await request(app.getHttpServer())
      .get(`/api/templates/${injectedId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body).not.toHaveProperty('recipients');
    expect(detail.body).not.toHaveProperty('recipientName');
    expect(detail.body).not.toHaveProperty('recipientEmail');
    expect(detail.body).not.toHaveProperty('signingOrder');
    expect(detail.body).not.toHaveProperty('contractAmount');
    expect(detail.body).not.toHaveProperty('contractValue');
    const detailSerialized = JSON.stringify(detail.body);
    expect(detailSerialized).not.toContain('signingOrder');
    expect(detailSerialized).not.toContain('contractAmount');
    expect(detailSerialized).not.toContain('contractValue');
    expect(detailSerialized).not.toContain('홍길동');
    expect(detailSerialized).not.toContain('hong@example.com');

    await prisma.template.delete({ where: { id: injectedId } }).catch(() => undefined);
  });

  it('lists the owner templates (newest first, no field layout)', async () => {
    // Prove *position*, not just presence: create a second, differently-named
    // template after `templateId` and assert it lands at index 0 — the
    // "newly saved item is always at the top of the list" guarantee behind
    // the save-success screen's "템플릿 목록으로 가기" flow.
    const second = await request(app.getHttpServer())
      .post('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '방금 저장한 템플릿',
        storageKey: `templates/${userId}/second.pdf`,
        pageCount: 1,
        fields: sampleFields,
      })
      .expect(201);
    const secondId: string = second.body.id;

    const res = await request(app.getHttpServer())
      .get('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const found = res.body.find((t: { id: string }) => t.id === templateId);
    expect(found).toBeDefined();
    expect(found.fieldCount).toBe(2);
    expect(found.fields).toBeUndefined();

    expect(res.body[0].id).toBe(secondId);
    expect(res.body[0].name).toBe('방금 저장한 템플릿');

    // Clean up so the Free-plan cap test below keeps counting from exactly
    // one pre-existing template (`templateId`), as it already assumes.
    await prisma.template.delete({ where: { id: secondId } }).catch(() => undefined);
  });

  it('fetches a single template incl. its fields and storage key', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.storageKey).toBe(`templates/${userId}/std.pdf`);
    expect(res.body.fields).toHaveLength(2);
  });

  it('streams the original PDF bytes to the owner (200, application/pdf)', async () => {
    // Seed the object the template points at so the stream has bytes to serve.
    await storage.save(`templates/${userId}/std.pdf`, SAMPLE_PDF);

    const res = await request(app.getHttpServer())
      .get(`/api/templates/${templateId}/file`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toContain('application/pdf');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.length).toBe(SAMPLE_PDF.length);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it("forbids streaming another owner's template PDF (403)", async () => {
    const other = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `filer_${Date.now()}@example.com`, password, name: '파일침입자' })
      .expect(201);
    const otherToken = other.body.accessToken;
    const otherId = other.body.user.id;

    await request(app.getHttpServer())
      .get(`/api/templates/${templateId}/file`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);

    await prisma.user.delete({ where: { id: otherId } }).catch(() => undefined);
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
