import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SigningController } from './signing.controller';
import { SigningService } from './signing.service';
import { SignerSessionService } from './signer-session.service';
import { SignerSessionGuard } from './signer-session.guard';

/**
 * Public signing flow keyed by SignRequest.accessToken.
 *
 * Registers its own JwtModule so the short-lived signer session token uses a
 * dedicated secret (SIGNER_JWT_SECRET), fully isolated from the sender JWT.
 * PrismaService and StorageService are provided by their @Global modules.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [SigningController],
  providers: [SigningService, SignerSessionService, SignerSessionGuard],
})
export class SigningModule {}
