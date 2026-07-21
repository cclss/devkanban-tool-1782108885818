import { Logger } from '@nestjs/common';
import { DEFAULT_JWT_SECRET } from '../auth/jwt.strategy';
import { DEFAULT_SIGNER_JWT_SECRET } from '../signing/signer-session.service';
import { DEFAULT_SHARE_JWT_SECRET } from '../sharing/share-session.service';
import { DEFAULT_SHARE_LINK_ENCRYPTION_KEY } from '../sharing/link-password-cipher';

/**
 * Secrets that MUST carry a real value in production. Each falls back to a
 * shared dev default so `pnpm dev` works with zero config — but that same
 * fallback silently signing tokens with a public constant in production would
 * let anyone forge sessions. We keep the fallback (dev DX) and instead warn
 * loudly at boot when it is still in effect under NODE_ENV=production.
 */
const REQUIRED_PRODUCTION_SECRETS: ReadonlyArray<{ name: string; devDefault: string }> = [
  { name: 'JWT_SECRET', devDefault: DEFAULT_JWT_SECRET },
  { name: 'SHARE_JWT_SECRET', devDefault: DEFAULT_SHARE_JWT_SECRET },
  { name: 'SIGNER_JWT_SECRET', devDefault: DEFAULT_SIGNER_JWT_SECRET },
  { name: 'SHARE_LINK_ENCRYPTION_KEY', devDefault: DEFAULT_SHARE_LINK_ENCRYPTION_KEY },
];

/**
 * At production boot, warn for every required secret that is unset or still at
 * its dev default. Non-throwing on purpose — it must not block startup, only
 * surface a misconfigured deploy in the logs. Returns the names that warned so
 * callers/tests can assert on the result.
 */
export function warnOnDefaultProductionSecrets(
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Logger, 'warn'> = new Logger('ProductionSecrets'),
): string[] {
  if (env.NODE_ENV !== 'production') return [];

  const insecure = REQUIRED_PRODUCTION_SECRETS.filter(({ name, devDefault }) => {
    const value = env[name];
    return !value || value === devDefault;
  }).map(({ name }) => name);

  for (const name of insecure) {
    logger.warn(
      `${name}가 프로덕션에서 설정되지 않았거나 개발용 기본값 그대로예요. ` +
        `배포 환경에 강한 시크릿을 반드시 설정해 주세요 — 미설정 시 세션 토큰이 공개된 값으로 서명됩니다.`,
    );
  }

  return insecure;
}
