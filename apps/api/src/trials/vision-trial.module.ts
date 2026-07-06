import { Module } from '@nestjs/common';
import { VisionTrialService } from './vision-trial.service';

/**
 * Provides the persistent Vision/LLM free-trial meter + access policy. Imported
 * wherever the premium auto-field engine access decision is made (the
 * heuristic→vision orchestration in grain-4) so the plan/trial rules live in one
 * place. PrismaModule is global, so no extra import is needed.
 */
@Module({
  providers: [VisionTrialService],
  exports: [VisionTrialService],
})
export class VisionTrialModule {}
