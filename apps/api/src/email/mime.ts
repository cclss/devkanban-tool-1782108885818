import { randomUUID } from 'crypto';

/* ────────────────────────────────────────────────────────────────────────────
 * Raw MIME builder (multipart/mixed + multipart/alternative)
 *
 * Pure, IO-free string assembly. Produces an RFC 5322 / RFC 2045 message that
 * AWS SES `SendEmail` accepts as `Content.Raw.Data`. Bodies are base64-encoded
 * (8-bit safe for UTF-8 Korean copy) and wrapped to 76 cols; non-ASCII headers
 * use RFC 2047 encoded-words; non-ASCII filenames use RFC 2231 `filename*`.
 * No design tokens live here — this is transport plumbing, not presentation.
 * ──────────────────────────────────────────────────────────────────────────── */

const CRLF = '\r\n';

export interface MimeAttachment {
  /** Display filename (may contain non-ASCII, e.g. "최종 계약서.pdf"). */
  filename: string;
  content: Buffer;
  /** MIME type; defaults to application/pdf. */
  contentType?: string;
}

export interface RawMimeInput {
  /** Envelope From — formatted address or bare email. */
  from: string;
  /** Recipient addresses (already formatted via `formatAddress`). */
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: MimeAttachment[];
  /** Optional Reply-To address. */
  replyTo?: string;
}

/** True when the string is plain US-ASCII with no header-breaking chars. */
function isPlainAscii(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(value);
}

/** RFC 2047 encoded-word (base64), chunked so each word stays under 75 chars. */
export function encodeHeaderText(value: string): string {
  if (isPlainAscii(value)) return value;
  const chars = Array.from(value); // split on code points, not UTF-16 units
  const words: string[] = [];
  for (let i = 0; i < chars.length; i += 10) {
    const slice = chars.slice(i, i + 10).join('');
    words.push(`=?UTF-8?B?${Buffer.from(slice, 'utf8').toString('base64')}?=`);
  }
  // Fold multiple encoded-words with CRLF + a single leading space.
  return words.join(`${CRLF} `);
}

/** Format `name <email>` with the display name encoded when non-ASCII. */
export function formatAddress(email: string, name?: string | null): string {
  const addr = email.trim();
  const display = name?.trim();
  if (!display) return addr;
  if (isPlainAscii(display) && !/[",<>@]/.test(display)) return `${display} <${addr}>`;
  return `${encodeHeaderText(display)} <${addr}>`;
}

/** Wrap a base64 blob to 76-column lines (RFC 2045). */
function wrap76(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? []).join(CRLF);
}

function base64Body(text: string): string {
  return wrap76(Buffer.from(text, 'utf8').toString('base64'));
}

/** A leaf MIME part: headers + base64 body. */
function leafPart(contentType: string, body: string): string {
  return [
    `Content-Type: ${contentType}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(body),
  ].join(CRLF);
}

/** RFC 2231 `filename*=UTF-8''…` plus an ASCII-safe `filename` fallback. */
function contentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
  const asciiFallback = isPlainAscii(filename)
    ? `"${filename.replace(/"/g, '')}"`
    : `"${encodeHeaderText(filename)}"`;
  return `Content-Disposition: attachment; filename=${asciiFallback}; filename*=UTF-8''${encoded}`;
}

function attachmentPart(att: MimeAttachment): string {
  const type = att.contentType?.trim() || 'application/pdf';
  return [
    `Content-Type: ${type}; name="${encodeHeaderText(att.filename)}"`,
    'Content-Transfer-Encoding: base64',
    contentDisposition(att.filename),
    '',
    wrap76(att.content.toString('base64')),
  ].join(CRLF);
}

/** Wrap one or more parts in a multipart container with a unique boundary. */
function multipart(subtype: string, parts: string[]): { headerType: string; body: string } {
  const boundary = `----=_${subtype}_${randomUUID()}`;
  const body = [
    ...parts.map((p) => `--${boundary}${CRLF}${p}`),
    `--${boundary}--`,
  ].join(CRLF);
  return { headerType: `multipart/${subtype}; boundary="${boundary}"`, body };
}

/**
 * Build the body region (the part that lives inside multipart/mixed, or the
 * whole message when there are no attachments): an alternative when both text
 * and html exist, otherwise a single leaf.
 */
function buildBodyRegion(html?: string, text?: string): { headerType: string; body: string } {
  const haveHtml = typeof html === 'string';
  const haveText = typeof text === 'string';
  if (haveHtml && haveText) {
    // Plain part first, then html — clients pick the richest they support.
    return multipart('alternative', [leafPart('text/plain', text!), leafPart('text/html', html!)]);
  }
  if (haveHtml) return { headerType: 'text/html; charset=UTF-8', body: base64WithHeader(html!) };
  return { headerType: 'text/plain; charset=UTF-8', body: base64WithHeader(text ?? '') };
}

/** Single-leaf body without the Content-Type line (caller supplies it). */
function base64WithHeader(text: string): string {
  return ['Content-Transfer-Encoding: base64', '', base64Body(text)].join(CRLF);
}

/** Assemble the full raw MIME message. */
export function buildRawMime(input: RawMimeInput): Buffer {
  const region = buildBodyRegion(input.html, input.text);
  const attachments = input.attachments ?? [];

  const topHeaders: string[] = [
    `From: ${input.from}`,
    `To: ${input.to.join(', ')}`,
  ];
  if (input.replyTo) topHeaders.push(`Reply-To: ${input.replyTo}`);
  topHeaders.push(`Subject: ${encodeHeaderText(input.subject)}`, 'MIME-Version: 1.0');

  if (attachments.length === 0) {
    // The body region is the whole message.
    const message = [`Content-Type: ${region.headerType}`, region.body].join(CRLF);
    return Buffer.from([...topHeaders, message].join(CRLF), 'utf8');
  }

  // multipart/mixed: [ body region as one part, ...attachments ]
  const bodyAsPart = [`Content-Type: ${region.headerType}`, region.body].join(CRLF);
  const mixed = multipart('mixed', [bodyAsPart, ...attachments.map(attachmentPart)]);
  return Buffer.from(
    [...topHeaders, `Content-Type: ${mixed.headerType}`, '', mixed.body].join(CRLF),
    'utf8',
  );
}
