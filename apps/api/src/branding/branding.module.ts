import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { BrandingGuard } from './branding.guard';

/**
 * Sender-branding feature module. PrismaModule and StorageModule are global, so
 * the service/guard get their dependencies without explicit imports here.
 */
@Module({
  controllers: [BrandingController],
  providers: [BrandingService, BrandingGuard],
})
export class BrandingModule {}
