/**
 * End-to-end for the auto-field-placement analysis endpoints (grain-3):
 *   GET  /documents/:id/field-suggestions   — stored candidates + analysis/trial status
 *   POST /documents/:id/premium-analysis     — Story 2 consent (spends one free trial)
 *
 * The three feature flows are exercised through the real orchestration, trial
 * meter, and grain-1 persistence — only the leaf engine seams (text extractor via
 * FieldDetectionService, the page renderer, and the Vision engine) are replaced
 * with deterministic fakes so a "text PDF" vs a "scanned PDF" can be driven
 * without a real PDF parser / external Vision service (the pipeline is otherwise
 * dark). A PDF's Title metadata carries the marker the fake detector branches on.
 *
 *   1. Text PDF     → suggestions returned immediately, no premium prompt.
 *   2. Scanned PDF  → invite (AWAITING_CONSENT); on consent the premium engine
 *                     runs, places fields, and one free trial is spent.
 *   3. Trials spent → a further scanned PDF resolves to the upgrade path.
 *
 * Plus the ownership / DRAFT / auth guards on both endpoints.
 */

// Point Prisma at the dedicated test database BEFORE the app initializes.
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
import { FieldDetectionService } from '../src/field-detection/field-detection.service';
import type { FieldDetectionResult } from '../src/field-detection/field-detection.types';
import { VisionDetectionService } from '../src/vision-detection/vision-detection.service';
import type {
  VisionEngineResult,
  VisionPageImage,
} from '../src/vision-detection/vision-detection.types';
import { PDF_PAGE_RENDERER } from '../src/field-analysis/pdf-page-renderer';

/** Build a 1-page PDF whose Title marks it text-based or scanned for the fake. */
async function makePdf(marker: 'TEXT' | 'SCAN'): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  doc.setTitle(marker);
  return Buffer.from(await doc.save());
}

/** Read the marker Title back out of a PDF's bytes (never throws). */
async function readMarker(pdf: Buffer): Promise<string> {
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    return doc.getTitle() ?? '';
  } catch {
    return '';
  }
}

// A confident heuristic result for a text PDF: one placed candidate, no fallback.
const TEXT_RESULT: FieldDetectionResult = {
  engine: 'heuristic',
  signal: 'ok',
  fields: [
    { type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, confidence: 0.9, anchorText: '서명' },
  ],
  meanConfidence: 0.9,
  fallbackToVision: false,
};

// A scanned PDF: no usable text layer → premium engine is the path forward.
const SCAN_RESULT: FieldDetectionResult = {
  engine: 'heuristic',
  signal: 'no-text',
  fields: [],
  meanConfidence: null,
  fallbackToVision: true,
};

/** Fake heuristic engine: text vs scan decided by the PDF's marker Title. */
const fakeDetection = {
  async analyze(pdf: Buffer): Promise<FieldDetectionResult> {
    return (await readMarker(pdf)) === 'TEXT' ? TEXT_RESULT : SCAN_RESULT;
  },
};

// Fake Vision engine: always places two fields once consent has been given.
const fakeVision = {
  async analyze(): Promise<VisionEngineResult> {
    return {
      ok: true,
      result: {
        engine: 'vision',
        signal: 'ok',
        fields: [
          { type: 'SIGNATURE', page: 1, x: 0.15, y: 0.7, width: 0.3, height: 0.08, confidence: 0.95, anchorText: '' },
          { type: 'DATE', page: 1, x: 0.55, y: 0.7, width: 0.2, height: 0.05, confidence: 0.9, anchorText: '' },
        ],
        meanConfidence: 0.92,
        fallbackToVision: false,
      },
    };
  },
};

// Fake renderer: one page image, so the Vision path proceeds past the empty guard.
const fakeRenderer = {
  async render(): Promise<VisionPageImage[]> {
    return [{ page: 1, width: 600, height: 800, mimeType: 'image/png', image: Buffer.from([0x89, 0x50]) }];
  },
};

interface Suggestion {
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface AnalysisBody {
  fields: Suggestion[];
  status: {
    visionStage: string;
    isPremium: boolean;
    trialsRemaining: number;
    upgradeRequired: boolean;
  };
}

describe('Field-suggestions flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  let otherToken: string;
  let otherUserId: string;

  const email = `analysis_${Date.now()}@example.com`;
  const otherEmail = `analysis_other_${Date.now()}@example.com`;
  const password = 'password1234';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FieldDetectionService)
      .useValue(fakeDetection)
      .overrideProvider(VisionDetectionService)
      .useValue(fakeVision)
      .overrideProvider(PDF_PAGE_RENDERER)
      .useValue(fakeRenderer)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const reg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: '분석테스터' })
      .expect(201);
    token = reg.body.accessToken;
    userId = reg.body.user.id;

    const other = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: otherEmail, password, name: '남' })
      .expect(201);
    otherToken = other.body.accessToken;
    otherUserId = other.body.user.id;
  });

  afterAll(async () => {
    for (const id of [userId, otherUserId]) {
      if (id) await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  async function upload(marker: 'TEXT' | 'SCAN'): Promise<string> {
    const pdf = await makePdf(marker);
    const res = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdf, { filename: `${marker.toLowerCase()}.pdf`, contentType: 'application/pdf' })
      .expect(201);
    return res.body.id as string;
  }

  async function getSuggestions(documentId: string, auth = token): Promise<AnalysisBody> {
    const res = await request(app.getHttpServer())
      .get(`/api/documents/${documentId}/field-suggestions`)
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);
    return res.body as AnalysisBody;
  }

  /** Poll GET until the background upload analysis has landed (predicate true). */
  async function waitFor(documentId: string, done: (b: AnalysisBody) => boolean): Promise<AnalysisBody> {
    for (let i = 0; i < 50; i += 1) {
      const body = await getSuggestions(documentId);
      if (done(body)) return body;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`analysis for ${documentId} did not settle in time`);
  }

  it('Story 1: a text PDF returns suggestions immediately with no premium prompt', async () => {
    const id = await upload('TEXT');
    const body = await waitFor(id, (b) => b.fields.length > 0);

    expect(body.fields).toHaveLength(1);
    expect(body.fields[0].type).toBe('SIGNATURE');
    expect(body.status.visionStage).toBe('not-needed');
    expect(body.status.upgradeRequired).toBe(false);
    expect(body.status.isPremium).toBe(false);
    // A text PDF never touches the premium engine, so the trial balance is intact.
    expect(body.status.trialsRemaining).toBe(2);
  });

  it('Story 2: a scanned PDF invites premium, and consent spends one trial + places fields', async () => {
    const id = await upload('SCAN');

    // Upload records an invite (AWAITING_CONSENT) — no trial spent yet.
    const invited = await waitFor(id, (b) => b.status.visionStage !== 'not-needed');
    expect(invited.status.visionStage).toBe('available');
    expect(invited.status.upgradeRequired).toBe(false);
    expect(invited.fields).toHaveLength(0);
    expect(invited.status.trialsRemaining).toBe(2);

    // Consent: the premium engine runs, places fields, and spends one trial.
    const consent = await request(app.getHttpServer())
      .post(`/api/documents/${id}/premium-analysis`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = consent.body as AnalysisBody;
    expect(body.status.visionStage).toBe('succeeded');
    expect(body.fields).toHaveLength(2);
    expect(body.status.trialsRemaining).toBe(1);
    expect(body.status.upgradeRequired).toBe(false);

    // The spend is persisted: a re-fetch shows the placed fields + updated count.
    const refetched = await getSuggestions(id);
    expect(refetched.status.visionStage).toBe('succeeded');
    expect(refetched.fields).toHaveLength(2);
    expect(refetched.status.trialsRemaining).toBe(1);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.visionTrialsUsed).toBe(1);
  });

  it('Story 4: after the 2 free trials are spent, a scanned PDF offers the upgrade path', async () => {
    // Spend the second (last) trial on another scanned document.
    const second = await upload('SCAN');
    await waitFor(second, (b) => b.status.visionStage === 'available');
    const secondConsent = await request(app.getHttpServer())
      .post(`/api/documents/${second}/premium-analysis`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((secondConsent.body as AnalysisBody).status.trialsRemaining).toBe(0);

    // A fresh scanned PDF now has no trials left → blocked / upgradeRequired.
    const third = await upload('SCAN');
    const blocked = await waitFor(third, (b) => b.status.visionStage !== 'not-needed');
    expect(blocked.status.visionStage).toBe('blocked');
    expect(blocked.status.upgradeRequired).toBe(true);
    expect(blocked.status.trialsRemaining).toBe(0);

    // Consent while exhausted spends nothing and keeps offering the upgrade.
    const denied = await request(app.getHttpServer())
      .post(`/api/documents/${third}/premium-analysis`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = denied.body as AnalysisBody;
    expect(body.status.upgradeRequired).toBe(true);
    expect(body.fields).toHaveLength(0);
    expect(body.status.trialsRemaining).toBe(0);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.visionTrialsUsed).toBe(2);
  });

  it('enforces the ownership guard on both endpoints', async () => {
    const id = await upload('TEXT');

    const getRes = await request(app.getHttpServer())
      .get(`/api/documents/${id}/field-suggestions`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    expect(getRes.body.message).toBe('이 계약에 접근할 권한이 없어요.');

    const postRes = await request(app.getHttpServer())
      .post(`/api/documents/${id}/premium-analysis`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    expect(postRes.body.message).toBe('이 계약에 접근할 권한이 없어요.');
  });

  it('requires authentication and 404s an unknown document', async () => {
    await request(app.getHttpServer())
      .get('/api/documents/whatever/field-suggestions')
      .expect(401);

    const res = await request(app.getHttpServer())
      .get('/api/documents/does-not-exist/field-suggestions')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(res.body.message).toBe('요청한 계약을 찾을 수 없어요.');
  });

  it('applies the DRAFT-state guard once a contract has been sent', async () => {
    const id = await upload('TEXT');
    await waitFor(id, (b) => b.fields.length > 0);

    await request(app.getHttpServer())
      .put(`/api/documents/${id}/fields`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fields: [{ type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }] })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/documents/${id}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipients: [{ email: 'signer@example.com' }] })
      .expect(200);

    const getRes = await request(app.getHttpServer())
      .get(`/api/documents/${id}/field-suggestions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(getRes.body.message).toBe('이미 발송된 계약이에요.');

    const postRes = await request(app.getHttpServer())
      .post(`/api/documents/${id}/premium-analysis`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(postRes.body.message).toBe('이미 발송된 계약이에요.');
  });
});
