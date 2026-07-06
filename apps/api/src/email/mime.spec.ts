import { buildRawMime, encodeHeaderText, formatAddress } from './mime';

/** Pull the raw bytes of a base64-encoded MIME part back to a UTF-8 string. */
function decodeBase64Block(message: string, afterMarker: RegExp): string {
  const idx = message.search(afterMarker);
  const tail = message.slice(idx);
  // The body starts after the blank line that follows the part headers.
  const bodyStart = tail.indexOf('\r\n\r\n') + 4;
  const rest = tail.slice(bodyStart);
  // Take lines until the next boundary / end.
  const b64 = rest.split(/\r\n--/)[0].replace(/\r\n/g, '');
  return Buffer.from(b64, 'base64').toString('utf8');
}

describe('encodeHeaderText', () => {
  it('passes plain ASCII through unchanged', () => {
    expect(encodeHeaderText('Hello World')).toBe('Hello World');
  });

  it('encodes Korean as RFC 2047 base64 words', () => {
    const out = encodeHeaderText('계약 완료');
    expect(out).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    // Round-trips back to the original.
    const decoded = out
      .split(/\r\n /)
      .map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8'))
      .join('');
    expect(decoded).toBe('계약 완료');
  });
});

describe('formatAddress', () => {
  it('returns a bare address when no name is given', () => {
    expect(formatAddress('a@b.com')).toBe('a@b.com');
  });

  it('keeps a plain ASCII display name unencoded', () => {
    expect(formatAddress('a@b.com', 'Acme')).toBe('Acme <a@b.com>');
  });

  it('encodes a non-ASCII display name', () => {
    expect(formatAddress('a@b.com', '홍길동')).toMatch(/^=\?UTF-8\?B\?.+\?= <a@b\.com>$/);
  });
});

describe('buildRawMime', () => {
  const base = {
    from: formatAddress('noreply@esign.kr', '전자계약'),
    to: [formatAddress('signer@example.com', '서명자')],
    subject: '[근로계약서] 계약이 모두 완료되었어요',
    html: '<p>완료</p>',
    text: '완료',
  };

  it('builds a multipart/mixed message with two attachments', () => {
    const raw = buildRawMime({
      ...base,
      attachments: [
        { filename: '최종 계약서.pdf', content: Buffer.from('PDF-A') },
        { filename: '감사 추적 인증서.pdf', content: Buffer.from('PDF-B') },
      ],
    }).toString('utf8');

    expect(raw).toContain('Content-Type: multipart/mixed; boundary=');
    expect(raw).toContain('Content-Type: multipart/alternative; boundary=');
    // Two attachment parts.
    expect(raw.match(/Content-Disposition: attachment/g)).toHaveLength(2);
    // Filenames carried via RFC 2231 filename* (percent-encoded UTF-8).
    expect(raw).toContain("filename*=UTF-8''");
    // Required top-level headers.
    expect(raw).toContain('MIME-Version: 1.0');
    expect(raw).toContain('To: ');
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it('encodes the HTML and text bodies as base64 and round-trips', () => {
    const raw = buildRawMime(base).toString('utf8');
    expect(raw).toContain('Content-Type: multipart/alternative; boundary=');
    const text = decodeBase64Block(raw, /Content-Type: text\/plain/);
    const html = decodeBase64Block(raw, /Content-Type: text\/html/);
    expect(text).toBe('완료');
    expect(html).toBe('<p>완료</p>');
  });

  it('preserves attachment bytes through base64', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 255]);
    const raw = buildRawMime({ ...base, attachments: [{ filename: 'x.pdf', content: bytes }] }).toString('utf8');
    const decoded = decodeBase64Block(raw, /Content-Disposition: attachment/);
    expect(Buffer.from(decoded, 'utf8').length).toBeGreaterThan(0);
    // Decode the actual attachment block directly to compare bytes.
    const idx = raw.indexOf('Content-Disposition: attachment');
    const bodyStart = raw.indexOf('\r\n\r\n', idx) + 4;
    const b64 = raw.slice(bodyStart).split(/\r\n--/)[0].replace(/\r\n/g, '');
    expect(Buffer.from(b64, 'base64').equals(bytes)).toBe(true);
  });

  it('omits the alternative wrapper when only html is provided and no attachments', () => {
    const raw = buildRawMime({ from: base.from, to: base.to, subject: 'hi', html: '<b>x</b>' }).toString('utf8');
    expect(raw).toContain('Content-Type: text/html; charset=UTF-8');
    expect(raw).not.toContain('multipart/mixed');
  });
});
