import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Email delivery module. Owns `EmailService` — the SES raw-MIME sender with a
 * console fallback (mirrors `NotificationsService`'s degradation policy). The
 * completion pipeline (grain-5) injects it to dispatch the final-document mail
 * with both PDF attachments. Global so any feature module can reuse it.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
