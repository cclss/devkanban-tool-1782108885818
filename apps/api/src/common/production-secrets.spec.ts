import { warnOnDefaultProductionSecrets } from './production-secrets';
import { DEFAULT_SIGNER_JWT_SECRET } from '../signing/signer-session.service';

describe('warnOnDefaultProductionSecrets', () => {
  const warn = jest.fn();
  const logger = { warn };

  beforeEach(() => warn.mockClear());

  it('never warns outside production, even with unset secrets', () => {
    const result = warnOnDefaultProductionSecrets({ NODE_ENV: 'development' }, logger);
    expect(result).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns for SIGNER_JWT_SECRET when unset in production', () => {
    const result = warnOnDefaultProductionSecrets({ NODE_ENV: 'production' }, logger);
    expect(result).toContain('SIGNER_JWT_SECRET');
    expect(warn).toHaveBeenCalled();
  });

  it('warns for SIGNER_JWT_SECRET when still at the dev default in production', () => {
    const result = warnOnDefaultProductionSecrets(
      { NODE_ENV: 'production', SIGNER_JWT_SECRET: DEFAULT_SIGNER_JWT_SECRET },
      logger,
    );
    expect(result).toContain('SIGNER_JWT_SECRET');
  });

  it('does not warn when every secret has a strong value in production', () => {
    const result = warnOnDefaultProductionSecrets(
      {
        NODE_ENV: 'production',
        JWT_SECRET: 'strong-sender',
        SHARE_JWT_SECRET: 'strong-share',
        SIGNER_JWT_SECRET: 'strong-signer',
        SHARE_LINK_ENCRYPTION_KEY: 'strong-cipher',
      },
      logger,
    );
    expect(result).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
