import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import { DocumentsModule } from './documents/documents.module';
import { SigningModule } from './signing/signing.module';
import { PdfModule } from './pdf/pdf.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    NotificationsModule,
    AuthModule,
    DocumentsModule,
    SigningModule,
    PdfModule,
    HealthModule,
  ],
})
export class AppModule {}
