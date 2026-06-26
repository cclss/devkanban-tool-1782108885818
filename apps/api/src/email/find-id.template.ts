/* ────────────────────────────────────────────────────────────────────────────
 * Find-ID emails (account recovery): verification-code mail + recovered-ID mail.
 *
 * Visual tone mirrors `completion-email.template.ts` — email clients can't read
 * CSS vars, so the same semantic token *values* (color/typography/spacing/
 * radius) are emitted as inline styles. Unlike the completion mail these are
 * system/account messages with no sender branding, so they use the product
 * service name and the default Toss-blue accent.
 *
 * All copy is fixed in `common/messages.ts` (MESSAGES.findId.*); do not
 * improvise wording here.
 * ──────────────────────────────────────────────────────────────────────────── */

import { MESSAGES } from '../common/messages';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const DEFAULT_SERVICE_NAME = '전자계약';

/* ── color/base tokens (concrete values; no CSS-var indirection in email) ── */
const COLOR = {
  background: '#f2f4f6',
  surface: '#ffffff',
  foreground: '#191f28',
  foregroundMuted: '#4e5968',
  foregroundSubtle: '#6b7684',
  border: '#e5e8eb',
  primaryDefault: '#1c64f2',
  primarySubtle: '#eef3fe',
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface ContentEmailArgs {
  serviceName: string;
  headline: string;
  /** Body paragraphs above the highlighted value. */
  bodyAbove: string[];
  /** The emphasized value (verification code or recovered ID). */
  highlight: string;
  /** Small caption under the highlight box (e.g. expiry note). */
  highlightCaption?: string;
  /** Body paragraphs below the highlighted value. */
  bodyBelow: string[];
  /** Muted footer disclaimer line. */
  disclaimer: string;
}

/** Shared single-column account-email layout (headline → body → highlight → footer). */
function renderContentHtml(args: ContentEmailArgs): string {
  const para = (line: string): string =>
    `<p style="margin:0 0 12px;font-size:15px;line-height:24px;color:${COLOR.foregroundMuted};">${escapeHtml(line)}</p>`;

  const aboveHtml = args.bodyAbove.map(para).join('');
  const belowHtml = args.bodyBelow.map(para).join('');

  const captionHtml = args.highlightCaption
    ? `<p style="margin:8px 0 0;font-size:13px;line-height:20px;color:${COLOR.foregroundSubtle};">${escapeHtml(args.highlightCaption)}</p>`
    : '';

  const highlightHtml =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="background:${COLOR.primarySubtle};border-radius:12px;">` +
    `<tr><td style="padding:20px 24px;text-align:center;">` +
    `<span style="display:block;font-size:26px;line-height:34px;font-weight:700;letter-spacing:0.08em;color:${COLOR.primaryDefault};word-break:break-all;">${escapeHtml(args.highlight)}</span>` +
    `</td></tr></table>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:${COLOR.background};font-family:'Pretendard Variable',Pretendard,system-ui,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.background};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${COLOR.surface};border-radius:16px;overflow:hidden;border:1px solid ${COLOR.border};">
        <tr><td style="height:4px;background:${COLOR.primaryDefault};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:24px 24px 0;font-size:15px;font-weight:600;color:${COLOR.foreground};">${escapeHtml(args.serviceName)}</td></tr>
        <tr><td style="padding:16px 24px 0;">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:30px;letter-spacing:-0.01em;font-weight:700;color:${COLOR.foreground};">${escapeHtml(args.headline)}</h1>
          ${aboveHtml}
        </td></tr>
        <tr><td style="padding:8px 24px 0;">${highlightHtml}${captionHtml}</td></tr>
        <tr><td style="padding:16px 24px 0;">${belowHtml}</td></tr>
        <tr><td style="padding:16px 24px 24px;border-top:1px solid ${COLOR.border};">
          <p style="margin:0;font-size:12px;line-height:18px;color:${COLOR.foregroundSubtle};">${escapeHtml(args.disclaimer)}</p>
          <p style="margin:4px 0 0;font-size:12px;line-height:18px;color:${COLOR.foregroundSubtle};">${escapeHtml(args.serviceName)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderContentText(args: ContentEmailArgs): string {
  const lines: string[] = [args.headline, ''];
  lines.push(...args.bodyAbove);
  lines.push('', args.highlight);
  if (args.highlightCaption) lines.push(args.highlightCaption);
  if (args.bodyBelow.length > 0) lines.push('', ...args.bodyBelow);
  lines.push('', args.disclaimer, args.serviceName);
  return lines.join('\n');
}

/** Verification-code email (request stage, email channel). */
export function renderFindIdCodeEmail(input: {
  code: string;
  serviceName?: string;
}): RenderedEmail {
  const copy = MESSAGES.findId.codeEmail;
  const serviceName = input.serviceName?.trim() || DEFAULT_SERVICE_NAME;
  const args: ContentEmailArgs = {
    serviceName,
    headline: copy.headline,
    bodyAbove: [copy.intro],
    highlight: input.code,
    highlightCaption: copy.expiry,
    bodyBelow: [],
    disclaimer: copy.disclaimer,
  };
  return { subject: copy.subject, html: renderContentHtml(args), text: renderContentText(args) };
}

/** Recovered-ID email (verify success, email channel) — carries the full ID. */
export function renderFindIdResultEmail(input: {
  accountId: string;
  serviceName?: string;
}): RenderedEmail {
  const copy = MESSAGES.findId.resultEmail;
  const serviceName = input.serviceName?.trim() || DEFAULT_SERVICE_NAME;
  const args: ContentEmailArgs = {
    serviceName,
    headline: copy.headline,
    bodyAbove: [copy.intro],
    highlight: input.accountId,
    bodyBelow: [copy.outro],
    disclaimer: copy.disclaimer,
  };
  return { subject: copy.subject, html: renderContentHtml(args), text: renderContentText(args) };
}
