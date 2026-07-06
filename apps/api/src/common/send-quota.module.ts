import { Module } from '@nestjs/common';
import { SendQuotaService } from './send-quota.service';

/**
 * Provides the shared Free-plan send quota. Imported by every feature that can
 * dispatch a contract (email send + share link) so the monthly allowance is
 * enforced identically across paths. PrismaModule is global, so no extra import.
 */
@Module({
  providers: [SendQuotaService],
  exports: [SendQuotaService],
})
export class SendQuotaModule {}
