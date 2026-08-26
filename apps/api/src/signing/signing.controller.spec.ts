import { SigningController } from './signing.controller';

describe('SigningController public metadata locale boundary', () => {
  it('passes the unauthenticated browser Accept-Language value to signing metadata', async () => {
    const signing = {
      meta: jest.fn().mockResolvedValue({ locale: 'en' }),
    };
    const controller = new SigningController(signing as never);

    const result = controller.meta('public-sign-token', 'en-US,en;q=0.9');

    expect(signing.meta).toHaveBeenCalledWith('public-sign-token', 'en-US,en;q=0.9');
    await expect(result).resolves.toEqual({ locale: 'en' });
  });
});
