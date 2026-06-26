import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SharingController } from './sharing.controller';
import { SharePublicController } from './share-public.controller';
import { SharingService } from './sharing.service';
import { ShareSessionService } from './share-session.service';
import { ShareSessionGuard } from './share-session.guard';
import { SigningModule } from '../signing/signing.module';

/**
 * Link-sharing flow (sender mints a self-serve open/fill link; an anonymous
 * recipient opens, fills, and submits it).
 *
 * Registers its own JwtModule so the short-lived share session token uses a
 * dedicated secret (SHARE_JWT_SECRET), isolated from both the sender JWT and the
 * signer-session secret. Imports SigningModule to reuse the field/submit/
 * completion machinery (`SigningService`) — the recipient and the OTP signer
 * share one implementation, only the access gate differs.
 */
@Module({
  imports: [JwtModule.register({}), SigningModule],
  controllers: [SharingController, SharePublicController],
  providers: [SharingService, ShareSessionService, ShareSessionGuard],
})
export class SharingModule {}
