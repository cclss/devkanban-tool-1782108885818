/**
 * End-to-end happy path for the sender flow:
 *   register/login → upload PDF → save sign fields → send contract.
 *
 * Asserts the contract transitions to 진행 중 (IN_PROGRESS), an audit log is
 * written, and the Free-plan monthly quota returns a clear Korean error once
 * five sends are used.
 */

// Point Prisma at the dedicated test database BEFORE the app (and its Prisma
// client) initialize. dotenv inside the app won't override an existing value.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://hermes@localhost/esign_test?host=/var/run/postgresql&schema=public';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'e2e-test-secret';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

async function makePdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return Buffer.from(await doc.save());
}

describe('Sender flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;

  const email = `sender_${Date.now()}@example.com`;
  const password = 'password1234';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
  });

  afterAll(async () => {
    if (userId) {
      // Cascades clean up documents / sign requests / fields / audit logs.
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await app.close();
  });

  it('registers a new sender and returns a JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: '테스터' })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.plan).toBe('FREE');
    token = res.body.accessToken;
    userId = res.body.user.id;
  });

  it('logs in with the same credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    token = res.body.accessToken;
  });

  it('rejects a wrong password with a Korean message', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
    expect(res.body.message).toBe('이메일 또는 비밀번호를 다시 확인해 주세요.');
  });

  it('blocks unauthenticated access to documents', async () => {
    await request(app.getHttpServer()).get('/api/documents').expect(401);
  });

  let documentId: string;

  it('uploads a PDF and creates a DRAFT document', async () => {
    const pdf = await makePdf(2);
    const res = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdf, { filename: 'contract.pdf', contentType: 'application/pdf' })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.statusLabel).toBe('작성 중');
    expect(res.body.pageCount).toBe(2);
    documentId = res.body.id;
  });

  it('rejects a non-PDF upload with a Korean message', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('hello world'), {
        filename: 'note.txt',
        contentType: 'text/plain',
      })
      .expect(400);
    expect(res.body.message).toBe('PDF 파일만 업로드할 수 있어요.');
  });

  it('supports the presign → local upload → create path', async () => {
    const presign = await request(app.getHttpServer())
      .post('/api/documents/presign')
      .set('Authorization', `Bearer ${token}`)
      .send({ filename: 'via-presign.pdf' })
      .expect(200);
    expect(presign.body.driver).toBe('local');
    expect(presign.body.storageKey).toBeDefined();

    const pdf = await makePdf(1);
    await request(app.getHttpServer())
      .put(presign.body.uploadUrl)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/pdf')
      .send(pdf)
      .expect(200);

    const created = await request(app.getHttpServer())
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ storageKey: presign.body.storageKey, title: '프리사인 계약' })
      .expect(201);
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.pageCount).toBe(1);
  });

  it('saves placed sign fields (normalized coordinates)', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/documents/${documentId}/fields`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fields: [
          { type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, recipientIndex: 0 },
          { type: 'DATE', page: 1, x: 0.5, y: 0.2, width: 0.2, height: 0.05, recipientIndex: 0 },
        ],
      })
      .expect(200);
    expect(res.body.count).toBe(2);
  });

  it('sends the contract → 진행 중, with sign requests and an audit log', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/documents/${documentId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipients: [{ email: 'signer@example.com', name: '서명자' }] })
      .expect(200);

    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.statusLabel).toBe('진행 중');
    expect(res.body.recipientCount).toBe(1);
    expect(res.body.sentAt).toBeTruthy();

    const signRequests = await prisma.signRequest.findMany({ where: { documentId } });
    expect(signRequests).toHaveLength(1);
    expect(signRequests[0].status).toBe('PENDING');
    expect(signRequests[0].accessToken).toHaveLength(48);
    expect(signRequests[0].verifyCode).toMatch(/^\d{6}$/);

    // Fields were assigned to the created sign request.
    const fields = await prisma.signField.findMany({ where: { documentId } });
    expect(fields.every((f) => f.signRequestId === signRequests[0].id)).toBe(true);

    const sentAudit = await prisma.auditLog.findFirst({
      where: { documentId, action: 'CONTRACT_SENT' },
    });
    expect(sentAudit).toBeTruthy();
    expect(sentAudit?.actorId).toBe(userId);
  });

  it('lists the contract on the dashboard as 진행 중', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const found = res.body.find((d: { id: string }) => d.id === documentId);
    expect(found).toBeDefined();
    expect(found.statusLabel).toBe('진행 중');
  });

  it('refuses to re-send an already sent contract', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/documents/${documentId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipients: [{ email: 'signer@example.com' }] })
      .expect(400);
    expect(res.body.message).toBe('이미 발송된 계약이에요.');
  });

  it('reports quota usage after one send', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/documents/quota')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.limit).toBe(5);
    expect(res.body.used).toBe(1);
    expect(res.body.remaining).toBe(4);
  });

  it('blocks the 6th monthly send with a clear Korean quota message', async () => {
    // Seed four more "sent" documents this month to reach the limit of 5.
    for (let i = 0; i < 4; i += 1) {
      await prisma.document.create({
        data: {
          ownerId: userId,
          title: `이전 계약 ${i}`,
          storageKey: `documents/${userId}/seed-${i}.pdf`,
          pageCount: 1,
          status: 'IN_PROGRESS',
          sentAt: new Date(),
        },
      });
    }

    // Prepare a fresh draft (upload + fields) and attempt to send it.
    const pdf = await makePdf(1);
    const upload = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdf, { filename: 'sixth.pdf', contentType: 'application/pdf' })
      .expect(201);
    const sixthId = upload.body.id;

    await request(app.getHttpServer())
      .put(`/api/documents/${sixthId}/fields`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fields: [{ type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }] })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/api/documents/${sixthId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipients: [{ email: 'signer@example.com' }] })
      .expect(403);

    expect(res.body.message).toBe(
      '이번 달 무료 발송 5건을 모두 사용했어요. 다음 달에 다시 발송하거나 플랜을 업그레이드해 주세요.',
    );

    // The blocked document stays a draft.
    const stillDraft = await prisma.document.findUnique({ where: { id: sixthId } });
    expect(stillDraft?.status).toBe('DRAFT');
  });
});
