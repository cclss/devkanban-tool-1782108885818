/**
 * DRAFT signing-link policy (M-8, 비-UI 검증).
 *
 * Policy: a signing link is signable ONLY while its document is IN_PROGRESS.
 * A DRAFT document (uploaded but never dispatched) must be blocked on every
 * signer path, and an IN_PROGRESS document must pass through all of them.
 *
 * The `isSignable` gate lives in five service methods — meta / verify / payload
 * / saveFields / complete — so this suite exercises each over real HTTP:
 *   - meta        → 200 with `signable: false` (never a hard error; the landing
 *                   screen still renders, just non-signable)
 *   - verify      → 403 `notSignable`  (the real signer can never get a session)
 *   - payload     → 403 `notSignable`
 *   - fields      → 403 `notSignable`
 *   - complete    → 403 `notSignable`
 *
 * payload/fields/complete are behind the SignerSessionGuard. A DRAFT signer can
 * never obtain a session (verify is blocked above), so to prove the *service*
 * gate is genuine defense-in-depth — not merely a side effect of the guard —
 * this suite mints a valid signer session directly and shows the gate still
 * rejects it. The `/pdf` route (openPdf) carries no `isSignable` check by
 * design; its DRAFT protection is the session guard, so it is asserted
 * unreachable without a session (401). See the pdf case for detail.
 *
 * REDIS_URL is unset so the completion queue degrades to the inline fallback,
 * matching the other e2e suites.
 */

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://hermes@localhost/esign_test?host=/var/run/postgresql&schema=public';
process.env.REDIS_URL = '';
process.env.SES_FROM_EMAIL = '';
process.env.JWT_SECRET = 'e2e-test-secret';
process.env.STORAGE_DIR = `/tmp/esign-e2e-storage-${process.pid}`;

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SignerSessionService } from '../src/signing/signer-session.service';
import { MESSAGES } from '../src/common/messages';

/** A tiny but valid 1×1 PNG, used as the captured signature value. */
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function makePdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return Buffer.from(await doc.save());
}

describe('Signing DRAFT policy (e2e, M-8)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SignerSessionService;

  const password = 'password1234';
  const createdUserIds: string[] = [];

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
    sessions = app.get(SignerSessionService);
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  /** Register a fresh sender and return their bearer token + id. */
  async function registerSender(name: string): Promise<{ token: string; userId: string }> {
    const reg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `${name}_${Date.now()}_${createdUserIds.length}@example.com`, password, name })
      .expect(201);
    createdUserIds.push(reg.body.user.id);
    return { token: reg.body.accessToken, userId: reg.body.user.id };
  }

  it('blocks a DRAFT link on every signer path and IN_PROGRESS passes them all', async () => {
    // --- Arrange: a DRAFT document that was NEVER sent, with a seeded signer. --
    const { token, userId } = await registerSender('초안발신자');
    const pdf = await makePdf(1);
    const upload = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdf, { filename: 'draft.pdf', contentType: 'application/pdf' })
      .expect(201);
    const draftDocId: string = upload.body.id;

    // The document is DRAFT straight after upload — no `send` has run.
    const draftDoc = await prisma.document.findUniqueOrThrow({ where: { id: draftDocId } });
    expect(draftDoc.status).toBe('DRAFT');

    // Seed a signer + field directly against the DRAFT document (a `send` would
    // have flipped it to IN_PROGRESS, which is exactly what we must NOT have).
    const draftAccess = `draft-access-${userId}`;
    const draftSr = await prisma.signRequest.create({
      data: {
        documentId: draftDocId,
        recipientEmail: 'draft-signer@example.com',
        recipientName: '서명자',
        accessToken: draftAccess,
        verifyCode: '654321',
      },
    });
    const draftField = await prisma.signField.create({
      data: {
        documentId: draftDocId,
        signRequestId: draftSr.id,
        type: 'SIGNATURE',
        page: 1,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.08,
      },
    });

    // --- Assert DRAFT is blocked on every signer path. -----------------------

    // meta: reachable, but reports the link as non-signable.
    const meta = await request(app.getHttpServer())
      .get(`/api/signing/${draftAccess}`)
      .expect(200);
    expect(meta.body.documentStatus).toBe('DRAFT');
    expect(meta.body.signable).toBe(false);

    // verify: the real signer path — 403 notSignable, so NO session is ever issued.
    const verifyRes = await request(app.getHttpServer())
      .post(`/api/signing/${draftAccess}/verify`)
      .send({ code: '654321' })
      .expect(403);
    expect(verifyRes.body.message).toBe(MESSAGES.signing.notSignable);

    // Mint a valid signer session directly to prove the service gate is genuine
    // defense-in-depth: even a session that clears the guard is rejected by the
    // isSignable check on payload/fields/complete.
    const draftSession = sessions.issue(draftSr.id);

    const payloadRes = await request(app.getHttpServer())
      .get(`/api/signing/${draftAccess}/payload`)
      .set('Authorization', `Bearer ${draftSession}`)
      .expect(403);
    expect(payloadRes.body.message).toBe(MESSAGES.signing.notSignable);

    const saveRes = await request(app.getHttpServer())
      .post(`/api/signing/${draftAccess}/fields`)
      .set('Authorization', `Bearer ${draftSession}`)
      .send({ fields: [{ fieldId: draftField.id, value: PNG_1x1 }] })
      .expect(403);
    expect(saveRes.body.message).toBe(MESSAGES.signing.notSignable);

    const completeRes = await request(app.getHttpServer())
      .post(`/api/signing/${draftAccess}/complete`)
      .set('Authorization', `Bearer ${draftSession}`)
      .expect(403);
    expect(completeRes.body.message).toBe(MESSAGES.signing.notSignable);

    // pdf: openPdf carries no isSignable gate by design; a DRAFT signer's
    // protection is the session guard. Since verify (above) never issues a
    // session, the PDF stream is unreachable → 401 without a bearer token.
    await request(app.getHttpServer())
      .get(`/api/signing/${draftAccess}/pdf`)
      .expect(401);

    // Nothing about the DRAFT document changed as a side effect of the attempts.
    const afterDraft = await prisma.document.findUniqueOrThrow({ where: { id: draftDocId } });
    expect(afterDraft.status).toBe('DRAFT');
    const afterField = await prisma.signField.findUniqueOrThrow({ where: { id: draftField.id } });
    expect(afterField.value).toBeNull();

    // --- Contrast: an IN_PROGRESS link passes every one of those paths. -------
    const inProgressPdf = await makePdf(1);
    const ipUpload = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', inProgressPdf, { filename: 'sent.pdf', contentType: 'application/pdf' })
      .expect(201);
    const ipDocId: string = ipUpload.body.id;

    await request(app.getHttpServer())
      .put(`/api/documents/${ipDocId}/fields`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fields: [
          { type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, recipientIndex: 0 },
        ],
      })
      .expect(200);

    // `send` dispatches the contract → document becomes IN_PROGRESS + a real
    // SignRequest (with verifyCode) is created.
    await request(app.getHttpServer())
      .post(`/api/documents/${ipDocId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipients: [{ email: 'sent-signer@example.com', name: '서명자' }] })
      .expect(200);

    const ipDoc = await prisma.document.findUniqueOrThrow({ where: { id: ipDocId } });
    expect(ipDoc.status).toBe('IN_PROGRESS');
    const ipSr = await prisma.signRequest.findFirstOrThrow({ where: { documentId: ipDocId } });
    const ipField = await prisma.signField.findFirstOrThrow({ where: { signRequestId: ipSr.id } });

    // meta: signable.
    const ipMeta = await request(app.getHttpServer())
      .get(`/api/signing/${ipSr.accessToken}`)
      .expect(200);
    expect(ipMeta.body.documentStatus).toBe('IN_PROGRESS');
    expect(ipMeta.body.signable).toBe(true);

    // verify: clears the gate and issues a session.
    const ipVerify = await request(app.getHttpServer())
      .post(`/api/signing/${ipSr.accessToken}/verify`)
      .send({ code: ipSr.verifyCode })
      .expect(200);
    const ipSession = ipVerify.body.sessionToken as string;
    expect(ipSession).toBeTruthy();

    // payload: returns the signer's fields.
    const ipPayload = await request(app.getHttpServer())
      .get(`/api/signing/${ipSr.accessToken}/payload`)
      .set('Authorization', `Bearer ${ipSession}`)
      .expect(200);
    expect(ipPayload.body.fields.length).toBeGreaterThanOrEqual(1);
    // grain-2: the payload always carries a well-formed `clauses` array. This
    // blank test PDF has no extractable text, so the no-error fallback yields
    // an empty array (never a missing field, never an error response).
    expect(Array.isArray(ipPayload.body.clauses)).toBe(true);

    // pdf: streams the document bytes.
    const ipPdf = await request(app.getHttpServer())
      .get(`/api/signing/${ipSr.accessToken}/pdf`)
      .set('Authorization', `Bearer ${ipSession}`)
      .expect(200);
    expect(ipPdf.headers['content-type']).toContain('application/pdf');

    // fields: persists the captured signature.
    const ipSave = await request(app.getHttpServer())
      .post(`/api/signing/${ipSr.accessToken}/fields`)
      .set('Authorization', `Bearer ${ipSession}`)
      .send({ fields: [{ fieldId: ipField.id, value: PNG_1x1 }] })
      .expect(200);
    expect(ipSave.body.saved).toBe(1);

    // complete: finalizes (only signer) → document completes.
    const ipComplete = await request(app.getHttpServer())
      .post(`/api/signing/${ipSr.accessToken}/complete`)
      .set('Authorization', `Bearer ${ipSession}`)
      .expect(200);
    expect(ipComplete.body.documentCompleted).toBe(true);
  });
});
