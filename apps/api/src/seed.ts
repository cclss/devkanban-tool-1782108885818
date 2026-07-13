/**
 * Development seed — sample data for the sender console.
 *
 * Populates the database with a demo sender account and a handful of sample
 * contracts so the whole "AI 핵심 조항 카드" signing experience can be walked
 * end-to-end and verified without hand-crafting data:
 *
 *   • Log in to the sender console (`/dashboard`) as the demo sender and see
 *     contracts across every status (DRAFT · 진행 중 · 완료) — the summary
 *     cards, kanban, urgency ordering and plan-usage bar all have data to show.
 *   • Open a seeded signing link (`/sign/:token`) or share link (`/share/:token`)
 *     and experience the summary-first reading screen: the 한 줄 요지, the 핵심
 *     조항 카드 (including a `caution` clause), the disclaimer, and — on finish —
 *     the completion card's contract recap.
 *   • See the graceful fallback: one 진행 중 contract has no summary
 *     (`clauseSummary = null`), so its reader shows only the plain original
 *     viewer (feature scenario 5).
 *
 * This is DEV-ONLY sample data. It never runs as part of the app; invoke it
 * explicitly:
 *
 *   pnpm --filter @repo/api seed
 *
 * It is idempotent: it wipes and re-creates everything owned by the single demo
 * sender (matched by email), so re-running always yields the same clean set.
 * Real users and their data are never touched.
 *
 * Storage: each contract gets a placeholder PDF written to the same local
 * storage root the API reads from (`STORAGE_DIR`, default `.storage`, resolved
 * against the process cwd — identical to `StorageService.localPath`). Run the
 * seed and the API from the same working directory (both default to `apps/api`)
 * so the signer's original-document viewer can stream the seeded bytes. The PDF
 * body is ASCII placeholder text; the Korean contract content lives in the
 * clause summary, which is what this feature renders.
 */

import { promises as fs } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import * as bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  prisma,
  Prisma,
  DocumentStatus,
  SignRequestStatus,
  SignRequestAccessMode,
  SignFieldType,
  type ClauseSummary,
} from '@repo/db';

// --- demo account -----------------------------------------------------------

/** The single demo sender the seed owns. Everything keyed off this email. */
const DEMO_EMAIL = 'demo@esign.dev';
const DEMO_NAME = '데모 발송자';
/** Plaintext demo password (documented so a reviewer can log in). */
const DEMO_PASSWORD = 'demo1234!';
/** Matches AuthService (`BCRYPT_ROUNDS = 10`) so login accepts the hash. */
const BCRYPT_ROUNDS = 10;

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

// --- local storage (mirrors StorageService.localPath) -----------------------

const STORAGE_DIR = process.env.STORAGE_DIR ?? '.storage';
const LOCAL_STORAGE_ROOT = isAbsolute(STORAGE_DIR)
  ? STORAGE_DIR
  : resolve(process.cwd(), STORAGE_DIR);

function localPath(key: string): string {
  const normalized = key.replace(/\.\.(\/|\\|$)/g, '');
  return join(LOCAL_STORAGE_ROOT, normalized);
}

/** Write bytes to the local storage root under `key`, creating parent dirs. */
async function writeObject(key: string, bytes: Buffer): Promise<void> {
  const full = localPath(key);
  await fs.mkdir(join(full, '..'), { recursive: true });
  await fs.writeFile(full, bytes);
}

/**
 * Build a small, valid placeholder PDF. Body text is ASCII only (StandardFonts
 * can't encode Hangul) — it exists solely so the original-document viewer has
 * real bytes to rasterize. `label` is an ASCII contract label, never the Korean
 * title.
 */
async function makeSamplePdf(label: string, pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const page = pdf.addPage([595, 842]); // A4 portrait, in points
    const { width, height } = page.getSize();
    page.drawText('SAMPLE CONTRACT', {
      x: 56,
      y: height - 84,
      size: 22,
      font: bold,
      color: rgb(0.1, 0.1, 0.12),
    });
    page.drawText(label, {
      x: 56,
      y: height - 116,
      size: 13,
      font,
      color: rgb(0.3, 0.3, 0.34),
    });
    // A few filler lines so the page isn't blank when rasterized.
    for (let line = 0; line < 12; line++) {
      page.drawText(
        'This is placeholder text for a seeded demo document. Not a real contract.',
        {
          x: 56,
          y: height - 168 - line * 26,
          size: 11,
          font,
          color: rgb(0.45, 0.45, 0.5),
        },
      );
    }
    page.drawText(`Page ${i} / ${pages}`, {
      x: width - 120,
      y: 48,
      size: 10,
      font,
      color: rgb(0.55, 0.55, 0.6),
    });
  }
  return Buffer.from(await pdf.save());
}

// --- sample clause summaries ------------------------------------------------
//
// Tone follows design-spec/messaging/clause-summary-copy.md: 해요체, 핵심 수치를
// 문장 안에 그대로 넣어 강조, 주의 조항은 emphasis: 'caution'. Shape follows
// design-spec/vocabulary/clause-summary.md (oneLiner + 3~5 clauses).

const FREELANCE_SUMMARY: ClauseSummary = {
  oneLiner: '3개월 동안 웹사이트를 만들어 주고, 대금 500만 원을 세 번에 나눠 받는 계약이에요.',
  clauses: [
    {
      headline: '대금은 500만 원을 세 번에 나눠 받아요',
      detail: '착수·중간·최종 단계마다 나눠 받고, 각 단계가 끝나면 7일 안에 지급돼요.',
      category: '대금',
      emphasis: 'normal',
      sourcePage: 1,
    },
    {
      headline: '결과물은 계약일로부터 3개월 안에 전달해요',
      detail: '정해진 기한 안에 완성한 웹사이트를 넘기기로 했어요.',
      category: '계약 기간',
      emphasis: 'normal',
      sourcePage: 1,
    },
    {
      headline: '기한을 넘기면 하루에 대금의 1%를 물어야 해요',
      detail: '약속한 날짜보다 늦어지면 늦은 일수만큼 지연배상금이 붙어요.',
      category: '지연배상',
      emphasis: 'caution',
      sourcePage: 2,
    },
    {
      headline: '저작권은 대금을 모두 받은 뒤에 넘어가요',
      detail: '최종 대금까지 지급되면 결과물에 대한 권리가 맡긴 분에게 이전돼요.',
      category: '저작권',
      emphasis: 'normal',
      sourcePage: 3,
    },
  ],
};

const EMPLOYMENT_SUMMARY: ClauseSummary = {
  oneLiner: '월급 300만 원을 받고 주 5일 일하는 정규직 근로계약이에요.',
  clauses: [
    {
      headline: '기본급은 매달 300만 원이에요',
      detail: '매월 25일에 급여를 받기로 했어요.',
      category: '임금',
      emphasis: 'normal',
      sourcePage: 1,
    },
    {
      headline: '일하는 시간은 주 5일, 하루 8시간이에요',
      detail: '월요일부터 금요일까지, 오전 9시부터 오후 6시까지 일해요.',
      category: '근무 시간',
      emphasis: 'normal',
      sourcePage: 1,
    },
    {
      headline: '수습 3개월 동안은 급여의 90%를 받아요',
      detail: '수습 기간이 끝나면 계약한 급여를 온전히 받아요.',
      category: '수습',
      emphasis: 'caution',
      sourcePage: 2,
    },
  ],
};

const NDA_SUMMARY: ClauseSummary = {
  oneLiner: '업무하며 알게 된 회사 정보를 지키기로 약속하는 계약이에요.',
  clauses: [
    {
      headline: '알게 된 정보는 외부에 알리지 않기로 했어요',
      detail: '업무 중 접한 비밀 정보를 다른 곳에 공유하거나 사용하지 않아요.',
      category: '비밀유지',
      emphasis: 'normal',
      sourcePage: 1,
    },
    {
      headline: '비밀을 지킬 의무는 계약이 끝난 뒤에도 3년간 이어져요',
      detail: '계약이 끝난 후에도 일정 기간 동안 정보를 보호해야 해요.',
      category: '계약 기간',
      emphasis: 'normal',
      sourcePage: 1,
    },
    {
      headline: '약속을 어기면 손해배상 책임을 질 수 있어요',
      detail: '정보를 유출해 회사에 손해가 생기면 이를 배상해야 할 수 있어요.',
      category: '손해배상',
      emphasis: 'caution',
      sourcePage: 2,
    },
  ],
};

// --- sample contract definitions -------------------------------------------

/** How a contract's single sign request is reached. */
type Access =
  | { mode: 'CODE'; email: string; name: string; token: string; code: string }
  | { mode: 'LINK'; token: string; label: string };

interface SampleContract {
  title: string;
  /** ASCII label drawn into the placeholder PDF (no Hangul). */
  pdfLabel: string;
  status: DocumentStatus;
  pageCount: number;
  clauseSummary: ClauseSummary | null;
  /** Absent for a DRAFT (not yet sent, so no recipient/link). */
  access?: Access;
  /** COMPLETED contracts carry downloadable artifacts + a completion time. */
  completed?: boolean;
}

const SAMPLES: SampleContract[] = [
  {
    title: '프리랜서 웹사이트 개발 용역계약서',
    pdfLabel: 'Freelance web development service agreement',
    status: DocumentStatus.IN_PROGRESS,
    pageCount: 3,
    clauseSummary: FREELANCE_SUMMARY,
    access: {
      mode: 'CODE',
      email: 'kim.designer@example.com',
      name: '김디자',
      token: 'demoOTP0000000000000000000000000000000000freelance',
      code: '246810',
    },
  },
  {
    title: '비밀유지계약서 (NDA)',
    pdfLabel: 'Non-disclosure agreement',
    status: DocumentStatus.IN_PROGRESS,
    pageCount: 2,
    clauseSummary: NDA_SUMMARY,
    access: {
      mode: 'LINK',
      token: 'demoLINK000000000000000000000000000000000000000nda',
      label: '공유 링크 · NDA',
    },
  },
  {
    title: '사무실 임대차계약서',
    pdfLabel: 'Office lease agreement',
    status: DocumentStatus.IN_PROGRESS,
    pageCount: 3,
    // Fallback demo: no summary → reader shows the plain original viewer only.
    clauseSummary: null,
    access: {
      mode: 'CODE',
      email: 'lee.tenant@example.com',
      name: '이임차',
      token: 'demoOTP00000000000000000000000000000000000000lease',
      code: '135791',
    },
  },
  {
    title: '표준 근로계약서',
    pdfLabel: 'Standard employment contract',
    status: DocumentStatus.COMPLETED,
    pageCount: 2,
    clauseSummary: EMPLOYMENT_SUMMARY,
    completed: true,
    access: {
      mode: 'CODE',
      email: 'park.employee@example.com',
      name: '박신입',
      token: 'demoOTP000000000000000000000000000000000employment',
      code: '112233',
    },
  },
  {
    title: '이사회 회의록 서명본 (초안)',
    pdfLabel: 'Board meeting minutes (draft)',
    status: DocumentStatus.DRAFT,
    pageCount: 1,
    clauseSummary: null,
  },
];

// --- seeding ----------------------------------------------------------------

/** ~14 / ~4 days ago, so urgency ordering (OVERDUE/DUE_SOON) has variety. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function seedContract(ownerId: string, sample: SampleContract): Promise<void> {
  const storageKey = `documents/${ownerId}/seed-${sample.pdfLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}.pdf`;

  // Placeholder PDF bytes so the original-document viewer can stream something.
  await writeObject(storageKey, await makeSamplePdf(sample.pdfLabel, sample.pageCount));

  const isSent = sample.status !== DocumentStatus.DRAFT;
  const sentAt = isSent ? daysAgo(sample.completed ? 9 : 4) : null;
  const completedAt = sample.completed ? daysAgo(2) : null;

  // COMPLETED contracts also get signed + certificate artifacts so the owner's
  // download actions work; their keys point at seeded placeholder PDFs.
  const signedKey = sample.completed ? `${storageKey}.signed.pdf` : null;
  const certificateKey = sample.completed ? `${storageKey}.certificate.pdf` : null;
  if (signedKey) await writeObject(signedKey, await makeSamplePdf(`${sample.pdfLabel} (signed)`, sample.pageCount));
  if (certificateKey) await writeObject(certificateKey, await makeSamplePdf(`${sample.pdfLabel} (certificate)`, 1));

  const document = await prisma.document.create({
    data: {
      ownerId,
      title: sample.title,
      storageKey,
      pageCount: sample.pageCount,
      status: sample.status,
      sentAt,
      completedAt,
      signedStorageKey: signedKey,
      certificateStorageKey: certificateKey,
      clauseSummary:
        sample.clauseSummary === null
          ? Prisma.DbNull
          : (sample.clauseSummary as unknown as Prisma.InputJsonValue),
    },
  });

  // A signature field on page 1 and a date field beside it (0..1 geometry).
  const fields = [
    { type: SignFieldType.SIGNATURE, page: 1, x: 0.14, y: 0.12, width: 0.34, height: 0.08 },
    { type: SignFieldType.DATE, page: 1, x: 0.56, y: 0.12, width: 0.28, height: 0.06 },
  ] as const;

  if (!sample.access) {
    // DRAFT: fields exist (so it's sendable) but there is no request yet.
    await prisma.signField.createMany({
      data: fields.map((f) => ({ ...f, documentId: document.id, recipientIndex: 0 })),
    });
    return;
  }

  const access = sample.access;
  const signed = sample.completed === true;
  const request = await prisma.signRequest.create({
    data: {
      documentId: document.id,
      order: 0,
      status: signed ? SignRequestStatus.SIGNED : SignRequestStatus.PENDING,
      accessToken: access.token,
      signedAt: signed ? completedAt : null,
      ...(access.mode === 'CODE'
        ? {
            accessMode: SignRequestAccessMode.CODE,
            recipientEmail: access.email,
            recipientName: access.name,
            verifyCode: access.code,
          }
        : {
            accessMode: SignRequestAccessMode.LINK,
            linkLabel: access.label,
          }),
    },
  });

  await prisma.signField.createMany({
    data: fields.map((f) => ({
      ...f,
      documentId: document.id,
      signRequestId: request.id,
      recipientIndex: 0,
      // A completed contract's fields already hold captured values.
      value: signed ? (f.type === SignFieldType.DATE ? '2026-07-11' : 'signed') : null,
    })),
  });

  // A light audit trail for sent/completed contracts (realistic dashboard data).
  await prisma.auditLog.create({
    data: { documentId: document.id, actorId: ownerId, action: 'CONTRACT_SENT' },
  });
  if (signed) {
    await prisma.auditLog.create({
      data: { documentId: document.id, signRequestId: request.id, action: 'DOCUMENT_SIGNED' },
    });
    await prisma.auditLog.create({
      data: { documentId: document.id, action: 'DOCUMENT_COMPLETED' },
    });
  }
}

async function main(): Promise<void> {
  const email = DEMO_EMAIL.toLowerCase();

  // Idempotent: remove the demo sender and everything they own (cascade), then
  // rebuild. Real accounts are never matched.
  await prisma.user.deleteMany({ where: { email } });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const owner = await prisma.user.create({
    data: { email, name: DEMO_NAME, passwordHash },
  });

  for (const sample of SAMPLES) {
    await seedContract(owner.id, sample);
  }

  // Print how to walk the seeded data (dev convenience — this is a CLI tool).
  console.log('\n✅ 샘플 데이터를 준비했어요.\n');
  console.log('발송자 콘솔 로그인:');
  console.log(`  ${WEB_ORIGIN}/login`);
  console.log(`  이메일: ${DEMO_EMAIL}`);
  console.log(`  비밀번호: ${DEMO_PASSWORD}\n`);
  console.log('서명자 경험(핵심 조항 카드) 확인 링크:');
  for (const s of SAMPLES) {
    if (!s.access) continue;
    if (s.access.mode === 'CODE') {
      const summary = s.clauseSummary ? '요약 있음' : '요약 없음(폴백)';
      console.log(`  [${s.title}] ${summary}`);
      console.log(`    ${WEB_ORIGIN}/sign/${s.access.token}  (인증 코드: ${s.access.code})`);
    } else {
      console.log(`  [${s.title}] 요약 있음`);
      console.log(`    ${WEB_ORIGIN}/share/${s.access.token}`);
    }
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error('시드 실행 중 문제가 생겼어요:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
