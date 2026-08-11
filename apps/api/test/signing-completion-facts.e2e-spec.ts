/**
 * Completion & re-entry fact round-trip over the live API (grain-5 / M-7 / S-6,
 * 검증 전용 — no production code is changed by this suite).
 *
 * The claim under test (server half of the completion screen + 재접속 화면):
 *
 *   1. `POST /api/signing/:token/complete` returns the signed-at instant plus
 *      the headline 계약 날짜·금액 derived from the document's own text, so the
 *      completion summary card can show REAL values (spec §6 / M-7) — not just
 *      the document title.
 *   2. `GET /api/signing/:token` (pre-auth meta) projects those same facts back
 *      on re-entry once SIGNED, together with `documentReady`, so the
 *      "이미 서명 완료된 계약입니다" screen shows the summary + a download link
 *      (spec §6 재접속 케이스 / S-6).
 *   3. Re-entering the sign flow is blocked (verify → 403 alreadySigned) so the
 *      sign viewer never re-mounts, while the session-bound artifact download
 *      still serves the signed PDF and is refused without a session.
 *
 * The PDF carries real, extractable Helvetica text with a money figure
 * ("1,200,000 KRW") and a date figure ("2026-08-11"), so the clause pipeline
 * surfaces genuine figures and `deriveContractFacts` has real values to project
 * — exercising the "추출 가능한 경우" branch end to end, not the null fallback.
 *
 * REDIS_URL is unset so the completion queue degrades to the inline fallback
 * (the signed PDF + certificate are generated synchronously inside `complete()`),
 * which is what makes `documentReady` flip to true within the request.
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
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** A tiny but valid 1×1 PNG data URL, used as the captured signature value. */
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** The figures the clause pipeline must surface, verbatim, from the PDF text. */
const EXPECTED_AMOUNT = '1,200,000 KRW';
const EXPECTED_DATE = '2026-08-11';

/**
 * A 1-page PDF whose Helvetica text contains a money figure then a date figure
 * (in that reading order). pdfjs extracts standard-font text verbatim, so the
 * clause pipeline yields real figures → `deriveContractFacts` returns real
 * `contractAmount` / `contractDate`.
 */
async function makeContractPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  const lines = [
    'Service Agreement',
    '',
    `Payment: the total contract amount is ${EXPECTED_AMOUNT}`,
    `and the effective date is ${EXPECTED_DATE} for a 12 month term.`,
  ];
  let y = 760;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 14, font });
    y -= 24;
  }
  return Buffer.from(await doc.save());
}

/** supertest response parser that collects a binary body into a Buffer. */
function binaryParser(res: any, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Completion & re-entry facts round-trip (e2e, M-7 / S-6)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const email = `facts_${Date.now()}@example.com`;
  const password = 'password1234';
  const signerEmail = 'facts-signer@example.com';

  let userId: string;
  let accessToken: string;
  let sessionToken: string;
  let completeSignedAt: string;

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
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await app.close();
  });

  it('complete() returns signedAt + real 계약 날짜·금액 through the running API', async () => {
    // Sender registers, uploads the text contract, places one signature field,
    // and sends → the single signer gets a verify code.
    const reg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: '팩트주식회사' })
      .expect(201);
    const bearer = reg.body.accessToken as string;
    userId = reg.body.user.id as string;

    const pdf = await makeContractPdf();
    const upload = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${bearer}`)
      .attach('file', pdf, { filename: 'agreement.pdf', contentType: 'application/pdf' })
      .expect(201);
    const documentId = upload.body.id as string;

    await request(app.getHttpServer())
      .put(`/api/documents/${documentId}/fields`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ fields: [{ type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, recipientIndex: 0 }] })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/documents/${documentId}/send`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ recipients: [{ email: signerEmail, name: '서명자' }] })
      .expect(200);

    const signRequest = await prisma.signRequest.findFirstOrThrow({ where: { documentId } });
    const field = await prisma.signField.findFirstOrThrow({ where: { signRequestId: signRequest.id } });
    accessToken = signRequest.accessToken;

    // Signer verifies → session, saves the signature, and finalizes.
    const verify = await request(app.getHttpServer())
      .post(`/api/signing/${accessToken}/verify`)
      .send({ code: signRequest.verifyCode })
      .expect(200);
    sessionToken = verify.body.sessionToken as string;

    await request(app.getHttpServer())
      .post(`/api/signing/${accessToken}/fields`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ fields: [{ fieldId: field.id, value: PNG_1x1 }] })
      .expect(200);

    const before = Date.now();
    const complete = await request(app.getHttpServer())
      .post(`/api/signing/${accessToken}/complete`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    const after = Date.now();

    // The completion summary card's real values, straight off the wire.
    expect(complete.body.status).toBe('SIGNED');
    expect(complete.body.documentCompleted).toBe(true);
    expect(complete.body.contractAmount).toBe(EXPECTED_AMOUNT);
    expect(complete.body.contractDate).toBe(EXPECTED_DATE);

    // signedAt is a valid ISO instant taken at completion time.
    expect(typeof complete.body.signedAt).toBe('string');
    const ts = Date.parse(complete.body.signedAt);
    expect(Number.isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
    expect(complete.body.signedAt).toBe(new Date(ts).toISOString());
    completeSignedAt = complete.body.signedAt;
  });

  it('meta() projects the same re-entry facts + documentReady once SIGNED (재접속)', async () => {
    // Pre-auth meta (no session): drives the "이미 서명 완료" re-entry screen.
    const meta = await request(app.getHttpServer())
      .get(`/api/signing/${accessToken}`)
      .expect(200);

    expect(meta.body.alreadySigned).toBe(true);
    expect(meta.body.status).toBe('SIGNED');
    // Same facts as the completion response — the summary card is reused verbatim.
    expect(meta.body.signedAt).toBe(completeSignedAt);
    expect(meta.body.contractAmount).toBe(EXPECTED_AMOUNT);
    expect(meta.body.contractDate).toBe(EXPECTED_DATE);
    // Inline completion stored the signed PDF → download link is offered.
    expect(meta.body.documentReady).toBe(true);
    // The document title is still present alongside the facts (not facts-only).
    expect(typeof meta.body.documentTitle).toBe('string');
    expect(meta.body.documentTitle.length).toBeGreaterThan(0);
  });

  it('re-entry blocks the sign flow but still serves the signed download link', async () => {
    // Re-verifying an already-signed link is refused → the sign viewer never
    // re-mounts (spec §6: "서명 입력 화면은 다시 표시되지 않는다").
    await request(app.getHttpServer())
      .post(`/api/signing/${accessToken}/verify`)
      .send({ code: '000000' })
      .expect(403);

    // The download link the re-entry screen shows resolves to the signed PDF
    // for a session-bound signer…
    const dl = await request(app.getHttpServer())
      .get(`/api/signing/${accessToken}/download/signed`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .buffer()
      .parse(binaryParser)
      .expect(200);
    expect(dl.headers['content-type']).toContain('application/pdf');
    expect(dl.headers['content-disposition']).toContain('attachment');
    const signed = await PDFDocument.load(dl.body);
    expect(signed.getPageCount()).toBeGreaterThan(0);

    // …and is refused without the session bearer (least privilege).
    await request(app.getHttpServer())
      .get(`/api/signing/${accessToken}/download/signed`)
      .expect(401);
  });
});
