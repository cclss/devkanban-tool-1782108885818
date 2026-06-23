import { Injectable } from '@nestjs/common';
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  PageSizes,
  StandardFonts,
  rgb,
  type Color,
} from 'pdf-lib';
import { embedKoreanFont } from './korean-font';
import { auditActionLabel } from './audit-action-labels';
import { maskEmail, maskIp, maskName } from '../common/masking';

/* ────────────────────────────────────────────────────────────────────────────
 * Input boundary
 *
 * The service is pure: input is already-queried domain data plus the final/原본
 * PDF hashes and the issue timestamp; output is the certificate PDF `Buffer`.
 * No DB / S3 / SES / queue access (grain-5). Output is deterministic — identical
 * input yields identical bytes; every timestamp comes from the input only.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Role of the actor behind a timeline event — drives masking & display. */
export type AuditActorRole = 'SENDER' | 'SIGNER' | 'SYSTEM';

/** One participant (signer) row for the participants section. */
export interface CertificateParticipant {
  name: string | null;
  email: string;
  /** 1-based signing order shown to the reader. */
  order: number;
  /** Identity-verification method, already human-readable (e.g. "6자리 인증코드"). */
  verificationMethod: string;
  /** When this signer completed signing (input timestamp; null if not signed). */
  signedAt: Date | string | null;
}

/** One audit event for the chronological timeline. */
export interface AuditEvent {
  /** Persisted `AuditLog.action` code (mapped to a Korean label for display). */
  action: string;
  /** When the event occurred (input timestamp). */
  occurredAt: Date | string;
  /** Actor display name (raw — masked here for signers). */
  actorName?: string | null;
  /** Actor role; controls masking and the system fallback. */
  actorRole?: AuditActorRole;
  /** Raw IP captured at event time (masked here). */
  ipAddress?: string | null;
}

export interface AuditCertificateInput {
  document: {
    id: string;
    title: string;
    /** Original document page count. */
    pageCount: number;
    /** When the contract was dispatched. */
    sentAt: Date | string | null;
    /** When all signatures completed. */
    completedAt: Date | string | null;
  };
  /** Contract sender — never masked (they own the contract). */
  sender: {
    name: string | null;
    email: string;
    /** Sender brand color hook (`#rgb`/`#rrggbb`); falls back to Toss blue. */
    brandColor?: string | null;
  };
  /** Signers in signing order. */
  participants: CertificateParticipant[];
  /** Full audit trail (any order — sorted ascending here for the timeline). */
  events: AuditEvent[];
  /** SHA-256 hex digest of the original uploaded PDF. */
  originalPdfSha256: string;
  /** SHA-256 hex digest of the final, signed PDF. */
  finalPdfSha256: string;
  /** Certificate issue timestamp (input only — keeps output deterministic). */
  issuedAt: Date | string;
  /** Unique certificate identifier shown on the cover and every footer. */
  certificateId: string;
  /** Footer service name. Defaults to the product name used in the web app. */
  serviceName?: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Design tokens → concrete values
 *
 * All visual values are sourced from the Design Spec token groups. Server PDFs
 * render in pt and cannot read CSS vars, so the semantic size scale is carried
 * here as pt values that preserve the spec's hierarchy ratios. Colors are the
 * exact `color/base` hex values (no format drift — converted to pdf-lib's 0..1
 * rgb at the single `hex()` boundary below).
 * ──────────────────────────────────────────────────────────────────────────── */

function hex(value: string): Color {
  const v = value.replace('#', '');
  const full =
    v.length === 3
      ? v
          .split('')
          .map((c) => c + c)
          .join('')
      : v;
  const n = parseInt(full, 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

/** color/base tokens. */
const COLOR = {
  surface: hex('#ffffff'),
  foreground: hex('#191f28'),
  foregroundMuted: hex('#4e5968'),
  foregroundSubtle: hex('#6b7684'),
  border: hex('#e5e8eb'),
  success: hex('#15c47e'),
  successSubtle: hex('#e7f9f1'),
  primaryDefault: '#1c64f2',
};

/** typography/base size scale (semantic role → pt, hierarchy ratios preserved). */
const SIZE = {
  coverTitle: 32, // text-size-3xl
  section: 19, // text-size-lg
  body: 15, // text-size-base
  subtitle: 17, // text-size-md
  label: 11, // text-size-2xs
  timeline: 12, // text-size-xs
  mono: 13, // text-size-sm
  footer: 11, // text-size-2xs
};

const WEIGHT_BOLD = true;

/** spacing/base scale (4px base) used as pt for page/section/item rhythm. */
const SPACE = {
  xs: 8, // space-xs
  sm: 12, // space-sm
  md: 16, // space-md
  lg: 24, // space-lg
  xl: 32, // space-xl (between sections)
  xxl: 48, // space-2xl (page outer margin)
};

const PAGE = PageSizes.A4; // [595.28, 841.89]
const MARGIN_X = SPACE.xxl;
const MARGIN_TOP = SPACE.xxl;
const MARGIN_BOTTOM = SPACE.xxl;
const CONTENT_WIDTH = PAGE[0] - MARGIN_X * 2;
const LABEL_COL_WIDTH = 132; // fixed label column for 2-col label/value rows

/** Faux-bold offset as a fraction of font size (we embed only the regular TTF). */
const FAUX_BOLD_RATIO = 0.025;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DEFAULT_SERVICE_NAME = '전자계약';

/**
 * Generates the audit-trail certificate PDF — a standalone legal record of a
 * contract's full history and integrity, laid out per the `audit-certificate`
 * Design Spec (cover → 계약 요약 → 참여자 → 이벤트 타임라인 → 무결성 지문).
 *
 * Reuses the shared Korean-font util (grain-2) for Hangul and the cross-cutting
 * masking + audit-action-label modules. Storage, email and the status
 * transition are out of scope (grain-5).
 */
@Injectable()
export class AuditCertificateService {
  async generate(input: AuditCertificateInput): Promise<Buffer> {
    const doc = await PDFDocument.create();

    // Deterministic metadata: pin all dates/producer so identical input → bytes.
    const issued = toDate(input.issuedAt);
    doc.setProducer('esign-saas');
    doc.setCreator('esign-saas');
    doc.setTitle('감사 추적 인증서');
    doc.setCreationDate(issued);
    doc.setModificationDate(issued);

    const font = await embedKoreanFont(doc);
    const mono = await doc.embedFont(StandardFonts.Courier);
    const primary = resolveBrandColor(input.sender.brandColor);
    const serviceName = input.serviceName?.trim() || DEFAULT_SERVICE_NAME;

    const r = new Renderer(doc, font, mono, primary);

    this.drawCover(r, input, primary);
    this.drawContractSummary(r, input);
    this.drawParticipants(r, input);
    this.drawTimeline(r, input);
    this.drawIntegrity(r, input);

    r.drawFooters(input.certificateId, serviceName);

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  /** Cover: brand accent + monogram, title, subtitle, issue meta, cert ID. */
  private drawCover(r: Renderer, input: AuditCertificateInput, primary: Color): void {
    // Top brand accent band.
    r.page.drawRectangle({
      x: MARGIN_X,
      y: r.cursor - 4,
      width: CONTENT_WIDTH,
      height: 4,
      color: primary,
    });
    r.cursor -= 4 + SPACE.lg;

    // Sender monogram + name (brand area).
    const monoSize = 28;
    const initial = (input.sender.name ?? input.sender.email).trim().charAt(0).toUpperCase() || '·';
    r.page.drawRectangle({
      x: MARGIN_X,
      y: r.cursor - monoSize,
      width: monoSize,
      height: monoSize,
      color: mixWhite(primary, 0.12), // primary-subtle wash
    });
    r.drawText(initial, MARGIN_X + monoSize / 2 - r.width(initial, SIZE.label) / 2, r.cursor - monoSize + 9, {
      size: SIZE.label,
      color: primary,
      bold: WEIGHT_BOLD,
    });
    r.drawText(input.sender.name ?? '발신자', MARGIN_X + monoSize + SPACE.sm, r.cursor - monoSize + 9, {
      size: SIZE.body,
      color: COLOR.foregroundMuted,
    });
    r.cursor -= monoSize + SPACE.lg;

    // Document-kind title (highest hierarchy).
    r.drawText('감사 추적 인증서', MARGIN_X, r.cursor - SIZE.coverTitle, {
      size: SIZE.coverTitle,
      color: COLOR.foreground,
      bold: WEIGHT_BOLD,
    });
    r.cursor -= SIZE.coverTitle + SPACE.sm;

    // Subtitle: contract title.
    r.drawWrapped(input.document.title, MARGIN_X, CONTENT_WIDTH, {
      size: SIZE.subtitle,
      color: COLOR.foregroundMuted,
    });
    r.cursor -= SPACE.lg;

    // Issue meta + certificate ID.
    r.drawLabelValue('발급 일시', `${fmtDateTime(input.issuedAt)} (KST)`);
    r.drawLabelValue('인증서 고유 ID', input.certificateId);
    r.drawLabelValue('대상 문서 ID', input.document.id);

    r.cursor -= SPACE.md;
    r.drawDivider();
    r.cursor -= SPACE.xl;
  }

  /** 계약 요약: label/value pairs + completion status pill. */
  private drawContractSummary(r: Renderer, input: AuditCertificateInput): void {
    r.startSection('계약 요약', 6 * (SIZE.body + SPACE.sm));
    r.drawLabelValue('계약명', input.document.title);
    r.drawLabelValue('원본 문서 페이지 수', `${input.document.pageCount}쪽`);
    r.drawLabelValue('발신자', input.sender.name ?? '—');
    r.drawLabelValue('발신자 이메일', input.sender.email);
    r.drawLabelValue('발송 일시', input.document.sentAt ? `${fmtDateTime(input.document.sentAt)} (KST)` : '—');
    r.drawLabelValue(
      '완료 일시',
      input.document.completedAt ? `${fmtDateTime(input.document.completedAt)} (KST)` : '—',
    );
    r.drawStatusRow('최종 상태', '완료됨');
    r.cursor -= SPACE.xl;
  }

  /** 참여자: one row per signer (name/email masked, order, method, signed-at). */
  private drawParticipants(r: Renderer, input: AuditCertificateInput): void {
    r.startSection('참여자', 3 * (SIZE.body + SIZE.timeline + SPACE.sm));

    if (input.participants.length === 0) {
      r.drawText('등록된 서명자가 없어요.', MARGIN_X, r.cursor - SIZE.body, {
        size: SIZE.body,
        color: COLOR.foregroundMuted,
      });
      r.cursor -= SIZE.body + SPACE.xl;
      return;
    }

    const ordered = [...input.participants].sort((a, b) => a.order - b.order);
    for (const p of ordered) {
      r.ensureSpace(SIZE.body + SIZE.timeline + SPACE.sm + SPACE.sm);
      // Primary line: order · masked name · masked email
      const head = `${p.order}. ${maskName(p.name)}`;
      r.drawText(head, MARGIN_X, r.cursor - SIZE.body, {
        size: SIZE.body,
        color: COLOR.foreground,
        bold: WEIGHT_BOLD,
      });
      r.drawText(maskEmail(p.email), MARGIN_X + r.width(head, SIZE.body) + SPACE.sm, r.cursor - SIZE.body, {
        size: SIZE.timeline,
        color: COLOR.foregroundSubtle,
      });
      r.cursor -= SIZE.body + SPACE.xs;
      // Secondary line: verification method · signed-at
      const signed = p.signedAt ? `${fmtDateTimeSec(p.signedAt)} (KST)` : '서명 전';
      r.drawText(`본인확인: ${p.verificationMethod}   ·   서명 완료: ${signed}`, MARGIN_X, r.cursor - SIZE.timeline, {
        size: SIZE.timeline,
        color: COLOR.foregroundMuted,
      });
      r.cursor -= SIZE.timeline + SPACE.sm;
      r.drawDivider();
      r.cursor -= SPACE.sm;
    }
    r.cursor -= SPACE.xl - SPACE.sm;
  }

  /** 이벤트 타임라인: ascending events with time axis + Korean action labels. */
  private drawTimeline(r: Renderer, input: AuditCertificateInput): void {
    r.startSection('이벤트 타임라인', 2 * (SIZE.body + SIZE.timeline + SPACE.md));

    const ordered = [...input.events].sort(
      (a, b) => toDate(a.occurredAt).getTime() - toDate(b.occurredAt).getTime(),
    );
    const axisX = MARGIN_X;
    const textX = MARGIN_X + 150; // time axis column width

    for (const e of ordered) {
      r.ensureSpace(SIZE.body + SIZE.timeline + SPACE.md);
      const top = r.cursor;
      // Left: precise timestamp (seconds).
      r.drawText(fmtDateTimeSec(e.occurredAt), axisX, top - SIZE.timeline, {
        size: SIZE.timeline,
        color: COLOR.foregroundMuted,
      });
      // Timeline dot.
      r.page.drawCircle({ x: textX - SPACE.md, y: top - SIZE.timeline + 3, size: 2.5, color: resolveBrandColor(input.sender.brandColor) });
      // Right: action label (primary) + actor/IP (secondary).
      r.drawText(auditActionLabel(e.action), textX, top - SIZE.body, {
        size: SIZE.body,
        color: COLOR.foreground,
        bold: WEIGHT_BOLD,
      });
      r.cursor = top - SIZE.body - SPACE.xs;
      const actor = resolveActor(e);
      const ip = e.ipAddress ? ` · IP ${maskIp(e.ipAddress)}` : '';
      r.drawText(`${actor}${ip}`, textX, r.cursor - SIZE.timeline, {
        size: SIZE.timeline,
        color: COLOR.foregroundSubtle,
      });
      r.cursor -= SIZE.timeline + SPACE.md;
    }
    r.cursor -= SPACE.xl - SPACE.md;
  }

  /** 문서 무결성 지문: algorithm + original & final SHA-256 (mono, wrapped). */
  private drawIntegrity(r: Renderer, input: AuditCertificateInput): void {
    r.startSection('문서 무결성 지문', 4 * (SIZE.mono + SPACE.sm));
    r.drawLabelValue('해시 알고리즘', 'SHA-256');
    r.drawLabelValue('인증서 발급', `${fmtDateTimeSec(input.issuedAt)} (KST)`);
    r.cursor -= SPACE.sm;

    r.drawText('원본 계약서', MARGIN_X, r.cursor - SIZE.label, {
      size: SIZE.label,
      color: COLOR.foregroundSubtle,
      bold: WEIGHT_BOLD,
    });
    r.cursor -= SIZE.label + SPACE.xs;
    r.drawMono(input.originalPdfSha256);
    r.cursor -= SPACE.sm;

    r.drawText('최종 계약서', MARGIN_X, r.cursor - SIZE.label, {
      size: SIZE.label,
      color: COLOR.foregroundSubtle,
      bold: WEIGHT_BOLD,
    });
    r.cursor -= SIZE.label + SPACE.xs;
    r.drawMono(input.finalPdfSha256);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Renderer — owns the page list, the vertical cursor, and primitive draws.
 * ──────────────────────────────────────────────────────────────────────────── */

interface TextOpts {
  size: number;
  color: Color;
  bold?: boolean;
}

class Renderer {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  /** Baseline-agnostic top cursor (y of the next content's top edge). */
  cursor = 0;

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly mono: PDFFont,
    private readonly primary: Color,
  ) {
    this.addPage();
  }

  private addPage(): void {
    this.page = this.doc.addPage(PAGE);
    this.page.drawRectangle({ x: 0, y: 0, width: PAGE[0], height: PAGE[1], color: COLOR.surface });
    this.pages.push(this.page);
    this.cursor = PAGE[1] - MARGIN_TOP;
  }

  width(text: string, size: number): number {
    return this.font.widthOfTextAtSize(text, size);
  }

  /** Move to a new page if `height` more content won't fit above the footer. */
  ensureSpace(height: number): void {
    if (this.cursor - height < MARGIN_BOTTOM + SIZE.footer + SPACE.md) {
      this.addPage();
    }
  }

  drawText(text: string, x: number, y: number, opts: TextOpts): void {
    this.page.drawText(text, { x, y, size: opts.size, font: this.font, color: opts.color });
    if (opts.bold) {
      // Faux-bold: re-draw with a tiny offset (only the regular TTF is embedded).
      const d = opts.size * FAUX_BOLD_RATIO;
      this.page.drawText(text, { x: x + d, y, size: opts.size, font: this.font, color: opts.color });
    }
  }

  /** Greedily wrap Korean text (no spaces) by character to fit `maxWidth`. */
  drawWrapped(text: string, x: number, maxWidth: number, opts: TextOpts): void {
    for (const line of wrapByWidth(text, (s) => this.width(s, opts.size), maxWidth)) {
      this.ensureSpace(opts.size + SPACE.xs);
      this.drawText(line, x, this.cursor - opts.size, opts);
      this.cursor -= opts.size + SPACE.xs;
    }
  }

  /** Two-column label/value row. */
  drawLabelValue(label: string, value: string): void {
    this.ensureSpace(SIZE.body + SPACE.sm);
    const baseY = this.cursor - SIZE.body;
    this.drawText(label, MARGIN_X, baseY, { size: SIZE.label, color: COLOR.foregroundSubtle });
    const valueX = MARGIN_X + LABEL_COL_WIDTH;
    for (const line of wrapByWidth(value, (s) => this.width(s, SIZE.body), CONTENT_WIDTH - LABEL_COL_WIDTH)) {
      this.drawText(line, valueX, this.cursor - SIZE.body, { size: SIZE.body, color: COLOR.foreground });
      this.cursor -= SIZE.body + SPACE.xs;
    }
    this.cursor -= SPACE.sm - SPACE.xs;
  }

  /** Status row whose value is a success-toned pill (완료됨). */
  drawStatusRow(label: string, value: string): void {
    this.ensureSpace(SIZE.body + SPACE.sm);
    const baseY = this.cursor - SIZE.body;
    this.drawText(label, MARGIN_X, baseY, { size: SIZE.label, color: COLOR.foregroundSubtle });
    const pillX = MARGIN_X + LABEL_COL_WIDTH;
    const padX = SPACE.xs;
    const w = this.width(value, SIZE.timeline) + padX * 2 + SPACE.md;
    const h = SIZE.timeline + SPACE.xs;
    this.page.drawRectangle({ x: pillX, y: baseY - 3, width: w, height: h, color: COLOR.successSubtle });
    this.page.drawCircle({ x: pillX + padX + 3, y: baseY - 3 + h / 2, size: 3, color: COLOR.success });
    this.drawText(value, pillX + padX + SPACE.sm, baseY - 3 + (h - SIZE.timeline) / 2 + 2, {
      size: SIZE.timeline,
      color: COLOR.foregroundMuted,
    });
    this.cursor -= SIZE.body + SPACE.sm;
  }

  /** Section heading with a short brand accent rule, orphan-guarded. */
  startSection(title: string, minBodyHeight: number): void {
    this.ensureSpace(SIZE.section + SPACE.md + minBodyHeight);
    this.page.drawRectangle({ x: MARGIN_X, y: this.cursor - SIZE.section + 2, width: 3, height: SIZE.section - 2, color: this.primary });
    this.drawText(title, MARGIN_X + SPACE.sm, this.cursor - SIZE.section, {
      size: SIZE.section,
      color: COLOR.foreground,
      bold: WEIGHT_BOLD,
    });
    this.cursor -= SIZE.section + SPACE.md;
  }

  drawDivider(): void {
    this.page.drawLine({
      start: { x: MARGIN_X, y: this.cursor },
      end: { x: MARGIN_X + CONTENT_WIDTH, y: this.cursor },
      thickness: 0.75,
      color: COLOR.border,
    });
  }

  /** Monospace hash, wrapped to the content width (fixed-width Courier). */
  drawMono(text: string): void {
    const charW = this.mono.widthOfTextAtSize('0', SIZE.mono);
    const perLine = Math.max(1, Math.floor(CONTENT_WIDTH / charW));
    for (let i = 0; i < text.length; i += perLine) {
      this.ensureSpace(SIZE.mono + SPACE.xs);
      this.page.drawText(text.slice(i, i + perLine), {
        x: MARGIN_X,
        y: this.cursor - SIZE.mono,
        size: SIZE.mono,
        font: this.mono,
        color: COLOR.foreground,
      });
      this.cursor -= SIZE.mono + SPACE.xs;
    }
  }

  /** Footer on every page: cert ID · N / M · service name. */
  drawFooters(certId: string, serviceName: string): void {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      const y = MARGIN_BOTTOM - SPACE.md;
      page.drawText(certId, { x: MARGIN_X, y, size: SIZE.footer, font: this.font, color: COLOR.foregroundSubtle });
      const pageLabel = `${i + 1} / ${total}`;
      const pw = this.font.widthOfTextAtSize(pageLabel, SIZE.footer);
      page.drawText(pageLabel, { x: MARGIN_X + (CONTENT_WIDTH - pw) / 2, y, size: SIZE.footer, font: this.font, color: COLOR.foregroundSubtle });
      const sw = this.font.widthOfTextAtSize(serviceName, SIZE.footer);
      page.drawText(serviceName, { x: MARGIN_X + CONTENT_WIDTH - sw, y, size: SIZE.footer, font: this.font, color: COLOR.foregroundSubtle });
    });
  }
}

/* ──────────────────────────── helpers ──────────────────────────── */

/** Resolve a sender brand color to pdf-lib rgb, falling back to Toss blue. */
function resolveBrandColor(brandColor: string | null | undefined): Color {
  const v = (brandColor ?? '').trim();
  return hex(HEX_COLOR.test(v) ? v : COLOR.primaryDefault);
}

/** Mix a color toward white by `ratio` of white (primary-subtle derivation). */
function mixWhite(color: Color, ratioBase: number): Color {
  const c = color as { red: number; green: number; blue: number };
  const k = ratioBase; // fraction of the base color retained
  return rgb(c.red * k + (1 - k), c.green * k + (1 - k), c.blue * k + (1 - k));
}

/** Display actor for a timeline event: sender raw, signer masked, else 시스템. */
function resolveActor(e: AuditEvent): string {
  if (e.actorRole === 'SYSTEM') return '시스템';
  if (e.actorRole === 'SENDER') return e.actorName?.trim() || '발신자';
  if (e.actorName && e.actorName.trim().length > 0) return maskName(e.actorName);
  return '시스템';
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Deterministic KST (UTC+9) wall-clock formatter — never reads the host
 * timezone. Shifts the epoch by +9h and reads UTC components.
 */
function fmtKst(value: Date | string, withSeconds: boolean): string {
  const ms = toDate(value).getTime();
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const base = `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return withSeconds ? `${base}:${p(d.getUTCSeconds())}` : base;
}

/** `YYYY.MM.DD HH:mm` (KST) — summaries/issue meta. */
function fmtDateTime(value: Date | string): string {
  return fmtKst(value, false);
}

/** `YYYY.MM.DD HH:mm:ss` (KST) — timeline & legal-precision timestamps. */
function fmtDateTimeSec(value: Date | string): string {
  return fmtKst(value, true);
}

/** Greedy character-wrap for spaceless Korean text to a measured max width. */
function wrapByWidth(text: string, measure: (s: string) => number, maxWidth: number): string[] {
  if (measure(text) <= maxWidth) return [text];
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    const next = cur + ch;
    if (cur.length > 0 && measure(next) > maxWidth) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = next;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}
