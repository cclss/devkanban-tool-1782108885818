import { Controller, Get, Param } from '@nestjs/common';
import { parseLocale, type SupportedLocale } from './locale-resolver';
import { SERVER_TRANSLATIONS } from './server-translations';

/** Read-only resource endpoint for browser clients. */
@Controller('i18n')
export class I18nController {
  @Get('resources/:locale')
  resources(@Param('locale') locale: string) {
    const resolved: SupportedLocale = parseLocale(locale) ?? 'ko';
    return { locale: resolved, resources: SERVER_TRANSLATIONS[resolved] };
  }
}
