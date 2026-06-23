import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SigningController } from './signing.controller';
import { SigningService } from './signing.service';
import { SignerSessionService } from './signer-session.service';
import { SignerSessionGuard } from './signer-session.guard';
import { CompletionModule } from '../completion/completion.module';

/**
 * Public signing flow keyed by SignRequest.accessToken.
 *
 * Registers its own JwtModule so the short-lived signer session token uses a
 * dedicated secret (SIGNER_JWT_SECRET), fully isolated from the sender JWT.
 * PrismaService and StorageService are provided by their @Global modules.
 * Imports CompletionModule to enqueue post-processing when the last signer
 * completes (grain-5).
 */
@Module({
  imports: [JwtModule.register({}), CompletionModule],
  controllers: [SigningController],
  providers: [SigningService, SignerSessionService, SignerSessionGuard],
})
export class SigningModule {}
