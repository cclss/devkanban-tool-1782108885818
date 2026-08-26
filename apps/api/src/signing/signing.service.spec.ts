import { SigningService } from './signing.service';

/**
 * Contract coverage for the unauthenticated signing-link metadata endpoint.
 * The client renders its first screen from `meta.locale`, before it has a
 * signer session, so this must remain independent of authenticated-user state.
 */
describe('SigningService.meta locale contract', () => {
  function serviceFor(senderLocale: unknown) {
    const prisma = {
      signRequest: {
        findUnique: jest.fn().mockResolvedValue({
          recipientName: 'Alex Kim',
          status: 'PENDING',
          document: {
            title: 'Employment agreement',
            pageCount: 3,
            status: 'IN_PROGRESS',
            owner: {
              name: 'Sender',
              brandColor: null,
              brandLogoUrl: null,
              locale: senderLocale,
            },
          },
        }),
      },
    };

    return new SigningService(prisma as never, {} as never, {} as never, {} as never);
  }

  it('uses an English sender locale ahead of a Korean recipient browser', async () => {
    const meta = await serviceFor('en').meta('sign-token', 'ko-KR,ko;q=0.9');

    expect(meta.locale).toBe('en');
    expect(meta.sender.locale).toBe('en');
  });

  it('uses Accept-Language when a legacy sender record has no usable locale', async () => {
    const meta = await serviceFor(null).meta('sign-token', 'fr-FR, en-US;q=0.8');

    expect(meta.locale).toBe('en');
  });

  it('returns Korean when neither sender nor browser supplies a supported locale', async () => {
    const meta = await serviceFor(undefined).meta('sign-token', 'fr-FR,ja;q=0.8');

    expect(meta.locale).toBe('ko');
  });
});
