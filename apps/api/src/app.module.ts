import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { DocumentsModule } from './documents/documents.module';
import { TemplatesModule } from './templates/templates.module';
import { SigningModule } from './signing/signing.module';
import { SharingModule } from './sharing/sharing.module';
import { PdfModule } from './pdf/pdf.module';
import { CompletionModule } from './completion/completion.module';
import { BrandingModule } from './branding/branding.module';
import { I18nModule } from './i18n/i18n.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    NotificationsModule,
    EmailModule,
    AuthModule,
    DocumentsModule,
    TemplatesModule,
    SigningModule,
    SharingModule,
    PdfModule,
    CompletionModule,
    BrandingModule,
    I18nModule,
    HealthModule,
  ],
})
export class AppModule {}
