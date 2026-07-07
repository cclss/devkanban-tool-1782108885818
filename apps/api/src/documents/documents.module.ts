import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import {
  DocumentConversionService,
  LIBREOFFICE_CONVERT,
} from './document-conversion.service';
import { createLibreOfficeConverter } from './libreoffice-convert.provider';
import { SendQuotaModule } from '../common/send-quota.module';

@Module({
  imports: [SendQuotaModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentConversionService,
    {
      // Real soffice-backed converter; swapped for a fake in unit tests.
      provide: LIBREOFFICE_CONVERT,
      useFactory: (config: ConfigService) => createLibreOfficeConverter(config),
      inject: [ConfigService],
    },
  ],
  exports: [DocumentsService, DocumentConversionService],
})
export class DocumentsModule {}
