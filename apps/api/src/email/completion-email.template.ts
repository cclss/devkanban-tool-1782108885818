/* ────────────────────────────────────────────────────────────────────────────
 * Completion email template (Design Spec: components/completion-email/base.md)
 *
 * Renders the *confirmed* copy from grain-1 (subject/headline/body/attachment
 * notice/footer) with sender branding. Email clients can't read CSS vars, so —
 * per the component's branding rule — colors/spacing/radius/typography are
 * emitted as inline styles using the semantic token values (color/typography/
 * spacing/radius base). Text hierarchy never relies on color alone.
 *
 * Copy is fixed in the spec; do not improvise wording here.
 * ──────────────────────────────────────────────────────────────────────────── */

export type CompletionEmailRole = 'SENDER' | 'SIGNER';

export interface CompletionEmailInput {
  /** Contract title — fills `{계약명}` in subject/body. */
  contractTitle: string;
  /** Sender display name — fills `{발신자명}` / brand header. */
  senderName: string;
  /** SENDER copy adds the dashboard line + CTA; SIGNER omits both. */
  recipientRole: CompletionEmailRole;
  /** Sender brand color (`#rgb`/`#rrggbb`); falls back to Toss blue. */
  brandColor?: string | null;
  /** Sender brand logo; when absent a monogram is shown. */
  brandLogoUrl?: string | null;
  /** Dashboard link for the sender-only CTA. */
  dashboardUrl?: string | null;
  /** Footer service name; defaults to the product name used elsewhere. */
  serviceName?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/* ── Confirmed copy (components/completion-email/base.md · voice.md) ──────── */
const COPY = {
  headline: '계약이 모두 완료되었어요',
  bodyAllDone: (title: string) => `${title} 계약의 모든 서명이 끝났어요.`,
  bodyAttachments:
    '최종 계약서와 감사 추적 인증서를 함께 보내 드려요. 첨부 파일에서 확인하실 수 있어요.',
  bodySenderExtra: '대시보드에서도 언제든 다시 내려받을 수 있어요.',
  attachments: [
    { name: '최종 계약서', note: '서명이 모두 담긴 완료본이에요.' },
    { name: '감사 추적 인증서', note: '계약 진행 이력과 문서 무결성을 증명하는 문서예요.' },
  ],
  ctaLabel: '대시보드에서 보기',
  footer: '이 메일은 계약 완료에 따라 자동으로 발송되었어요.',
} as const;

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
  primaryForeground: '#ffffff',
  successSubtle: '#e7f9f1',
  success: '#15c47e',
} as const;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Validate a sender brand color, falling back to Toss blue. */
function resolveBrandColor(brandColor: string | null | undefined): string {
  const v = (brandColor ?? '').trim();
  return HEX_COLOR.test(v) ? v : COLOR.primaryDefault;
}

/** Expand a #rgb / #rrggbb hex to [r,g,b] 0..255. */
function toRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  const n = parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Derive the primary-subtle wash: `ratioBase` of the brand color + the rest
 * white. Mirrors `branding.ts` (`color-mix(... 12%, #fff)`) and the certificate
 * service, but emits a concrete hex (email clients can't run color-mix).
 */
function mixWhiteHex(hex: string, ratioBase: number): string {
  const [r, g, b] = toRgb(hex);
  const k = ratioBase;
  const mix = (c: number) => Math.round(c * k + 255 * (1 - k));
  const h = (c: number) => mix(c).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** First grapheme of the sender name/email, for the monogram fallback. */
function monogramInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '·';
}

export function renderCompletionEmail(input: CompletionEmailInput): RenderedEmail {
  const title = input.contractTitle.trim();
  const senderName = input.senderName.trim() || '발신자';
  const serviceName = input.serviceName?.trim() || DEFAULT_SERVICE_NAME;
  const isSender = input.recipientRole === 'SENDER';
  const brand = resolveBrandColor(input.brandColor);
  const brandSubtle = mixWhiteHex(brand, 0.12);
  const showCta = isSender && Boolean(input.dashboardUrl);

  const subject = `[${title}] 계약이 모두 완료되었어요`;

  const html = renderHtml({
    title,
    senderName,
    serviceName,
    isSender,
    brand,
    brandSubtle,
    brandLogoUrl: input.brandLogoUrl ?? null,
    dashboardUrl: showCta ? input.dashboardUrl! : null,
  });

  const text = renderText({ title, senderName, serviceName, isSender, dashboardUrl: showCta ? input.dashboardUrl! : null });

  return { subject, html, text };
}

interface RenderArgs {
  title: string;
  senderName: string;
  serviceName: string;
  isSender: boolean;
  brand: string;
  brandSubtle: string;
  brandLogoUrl: string | null;
  dashboardUrl: string | null;
}

function renderBrandMark(args: RenderArgs): string {
  if (args.brandLogoUrl) {
    return (
      `<img src="${escapeHtml(args.brandLogoUrl)}" alt="${escapeHtml(args.senderName)} 로고" ` +
      `width="40" height="40" style="display:block;width:40px;height:40px;border-radius:12px;object-fit:contain;border:0;outline:none;text-decoration:none;" />`
    );
  }
  // Monogram fallback: primary-subtle bg + primary text, radius-md, text-md/bold —
  // matches the web BrandingHeader monogram (h-10 w-10 rounded-md bg-primary-subtle).
  return (
    `<span style="display:inline-block;width:40px;height:40px;line-height:40px;text-align:center;` +
    `background:${args.brandSubtle};color:${args.brand};border-radius:12px;` +
    `font-size:17px;font-weight:700;">${escapeHtml(monogramInitial(args.senderName))}</span>`
  );
}

function renderHtml(args: RenderArgs): string {
  const bodyLines = [
    COPY.bodyAllDone(args.title),
    COPY.bodyAttachments,
    ...(args.isSender ? [COPY.bodySenderExtra] : []),
  ];

  const bodyHtml = bodyLines
    .map(
      (line) =>
        `<p style="margin:0 0 12px;font-size:15px;line-height:24px;color:${COLOR.foregroundMuted};">${escapeHtml(line)}</p>`,
    )
    .join('');

  const attachmentRows = COPY.attachments
    .map(
      (a) =>
        `<tr><td style="padding:12px 16px;border-bottom:1px solid ${COLOR.border};">` +
        `<span style="display:block;font-size:15px;font-weight:600;color:${COLOR.foreground};">${escapeHtml(a.name)}</span>` +
        `<span style="display:block;margin-top:4px;font-size:13px;line-height:20px;color:${COLOR.foregroundSubtle};">${escapeHtml(a.note)}</span>` +
        `</td></tr>`,
    )
    .join('');

  const ctaHtml = args.dashboardUrl
    ? `<tr><td style="padding-top:8px;">` +
      `<a href="${escapeHtml(args.dashboardUrl)}" ` +
      `style="display:inline-block;background:${args.brand};color:${COLOR.primaryForeground};` +
      `font-size:15px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:12px;">` +
      `${escapeHtml(COPY.ctaLabel)}</a></td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:${COLOR.background};font-family:'Pretendard Variable',Pretendard,system-ui,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.background};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${COLOR.surface};border-radius:16px;overflow:hidden;border:1px solid ${COLOR.border};">
        <tr><td style="height:4px;background:${args.brand};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:24px 24px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">${renderBrandMark(args)}</td>
            <td style="vertical-align:middle;padding-left:12px;font-size:15px;font-weight:600;color:${COLOR.foreground};">${escapeHtml(args.senderName)}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px 24px 0;">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:30px;letter-spacing:-0.01em;font-weight:700;color:${COLOR.foreground};">${escapeHtml(COPY.headline)}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:8px 24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLOR.border};border-radius:12px;overflow:hidden;">
            ${attachmentRows}
          </table>
        </td></tr>
        <tr><td style="padding:16px 24px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0">${ctaHtml}</table>
        </td></tr>
        <tr><td style="padding:16px 24px 24px;border-top:1px solid ${COLOR.border};">
          <p style="margin:0;font-size:12px;line-height:18px;color:${COLOR.foregroundSubtle};">${escapeHtml(COPY.footer)}</p>
          <p style="margin:4px 0 0;font-size:12px;line-height:18px;color:${COLOR.foregroundSubtle};">${escapeHtml(args.serviceName)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderText(args: {
  title: string;
  senderName: string;
  serviceName: string;
  isSender: boolean;
  dashboardUrl: string | null;
}): string {
  const lines: string[] = [
    COPY.headline,
    '',
    COPY.bodyAllDone(args.title),
    COPY.bodyAttachments,
  ];
  if (args.isSender) lines.push(COPY.bodySenderExtra);
  lines.push('', '첨부');
  for (const a of COPY.attachments) lines.push(`- ${a.name} — ${a.note}`);
  if (args.dashboardUrl) lines.push('', `${COPY.ctaLabel}: ${args.dashboardUrl}`);
  lines.push('', COPY.footer, args.serviceName);
  return lines.join('\n');
}
