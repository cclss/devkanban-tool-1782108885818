import { renderCompletionEmail } from './completion-email.template';

describe('renderCompletionEmail', () => {
  const base = {
    contractTitle: '근로계약서',
    senderName: '주식회사 토스',
  } as const;

  it('renders the confirmed subject with the contract title', () => {
    const { subject } = renderCompletionEmail({ ...base, recipientRole: 'SIGNER' });
    expect(subject).toBe('[근로계약서] 계약이 모두 완료되었어요');
  });

  it('includes headline, body, and both attachment notices (confirmed copy)', () => {
    const { html, text } = renderCompletionEmail({ ...base, recipientRole: 'SIGNER' });
    for (const out of [html, text]) {
      expect(out).toContain('계약이 모두 완료되었어요');
      expect(out).toContain('근로계약서 계약의 모든 서명이 끝났어요.');
      expect(out).toContain('최종 계약서와 감사 추적 인증서를 함께 보내 드려요.');
      expect(out).toContain('최종 계약서');
      expect(out).toContain('서명이 모두 담긴 완료본이에요.');
      expect(out).toContain('감사 추적 인증서');
      expect(out).toContain('계약 진행 이력과 문서 무결성을 증명하는 문서예요.');
      expect(out).toContain('이 메일은 계약 완료에 따라 자동으로 발송되었어요.');
    }
  });

  it('omits the dashboard line and CTA for signer recipients', () => {
    const { html, text } = renderCompletionEmail({
      ...base,
      recipientRole: 'SIGNER',
      dashboardUrl: 'https://app.esign.kr/dashboard',
    });
    expect(html).not.toContain('대시보드에서도 언제든 다시 내려받을 수 있어요.');
    expect(html).not.toContain('대시보드에서 보기');
    expect(text).not.toContain('대시보드에서 보기');
  });

  it('adds the dashboard line and CTA for sender recipients with a dashboard URL', () => {
    const url = 'https://app.esign.kr/dashboard';
    const { html, text } = renderCompletionEmail({
      ...base,
      recipientRole: 'SENDER',
      dashboardUrl: url,
    });
    expect(html).toContain('대시보드에서도 언제든 다시 내려받을 수 있어요.');
    expect(html).toContain('대시보드에서 보기');
    expect(html).toContain(`href="${url}"`);
    expect(text).toContain(`대시보드에서 보기: ${url}`);
  });

  it('keeps the sender dashboard line even without a CTA URL but drops the button', () => {
    const { html } = renderCompletionEmail({ ...base, recipientRole: 'SENDER' });
    expect(html).toContain('대시보드에서도 언제든 다시 내려받을 수 있어요.');
    expect(html).not.toContain('대시보드에서 보기');
  });

  it('applies a valid brand color to the accent bar and falls back to Toss blue otherwise', () => {
    const branded = renderCompletionEmail({ ...base, recipientRole: 'SIGNER', brandColor: '#e94560' });
    expect(branded.html).toContain('#e94560');

    const fallback = renderCompletionEmail({ ...base, recipientRole: 'SIGNER', brandColor: 'not-a-color' });
    expect(fallback.html).toContain('#1c64f2');
  });

  it('renders a brand logo when provided, else a monogram', () => {
    const withLogo = renderCompletionEmail({
      ...base,
      recipientRole: 'SIGNER',
      brandLogoUrl: 'https://cdn.esign.kr/logo.png',
    });
    expect(withLogo.html).toContain('<img src="https://cdn.esign.kr/logo.png"');

    const withMonogram = renderCompletionEmail({ ...base, recipientRole: 'SIGNER' });
    // First grapheme of the sender name, uppercased.
    expect(withMonogram.html).toContain('>주<');
  });

  it('uses the default service name in the footer when none is given', () => {
    const { html } = renderCompletionEmail({ ...base, recipientRole: 'SIGNER' });
    expect(html).toContain('전자계약');
  });

  it('escapes HTML-significant characters in dynamic copy', () => {
    const { html } = renderCompletionEmail({
      contractTitle: '<b>계약</b> & 부속',
      senderName: 'A & B',
      recipientRole: 'SIGNER',
    });
    expect(html).toContain('&lt;b&gt;계약&lt;/b&gt; &amp; 부속');
    expect(html).not.toContain('<b>계약</b> & 부속');
  });
});
