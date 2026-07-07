import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';

/**
 * Service-wide branding: logo/favicon upload + persistence, brand color, and
 * public asset serving. StorageService is provided globally (StorageModule);
 * PrismaService via the global PrismaModule.
 */
@Module({
  controllers: [BrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
