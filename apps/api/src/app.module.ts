import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { DocumentsModule } from './documents/documents.module';
import { SigningModule } from './signing/signing.module';
import { SharingModule } from './sharing/sharing.module';
import { PdfModule } from './pdf/pdf.module';
import { CompletionModule } from './completion/completion.module';
import { BrandingModule } from './branding/branding.module';

@Module({
  imports: [
    // The single source of truth for local config is the monorepo-root `.env`
    // (README: `cp .env.example .env`). Turbo/Nest launch this app with cwd
    // `apps/api`, and Nest does not auto-load a parent-directory `.env`, so the
    // default (cwd-only) lookup silently finds nothing and Prisma boots without
    // `DATABASE_URL` — crashing the whole signer data path. Point ConfigModule
    // explicitly at the root file. The candidates cover both launch styles
    // (cwd=apps/api under turbo, cwd=repo-root for ad-hoc runs, and a path
    // resolved from this compiled module). Missing files are ignored, and an
    // already-set process env var (e.g. platform-injected in production) always
    // wins over the file.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(process.cwd(), '.env'),
        join(process.cwd(), '..', '..', '.env'),
        join(__dirname, '..', '..', '..', '.env'),
      ],
    }),
    PrismaModule,
    StorageModule,
    NotificationsModule,
    EmailModule,
    AuthModule,
    DocumentsModule,
    SigningModule,
    SharingModule,
    PdfModule,
    CompletionModule,
    BrandingModule,
    HealthModule,
  ],
})
export class AppModule {}
