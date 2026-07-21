import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { warnOnDefaultProductionSecrets } from './common/production-secrets';

async function bootstrap(): Promise<void> {
  // Surface a misconfigured deploy (dev-default/unset secrets in production)
  // before we start accepting traffic. Non-throwing — fallbacks still apply.
  warnOnDefaultProductionSecrets();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Captured signature values arrive as base64 image dataURLs, which exceed
  // the 100kb body-parser default. Raise the JSON limit so the signer's
  // `POST /signing/:token/fields` request is accepted.
  app.useBodyParser('json', { limit: '8mb' });
  app.useBodyParser('urlencoded', { limit: '8mb', extended: true });

  // Allow the web app (and signer pages) to call the API. `WEB_ORIGIN` may list
  // several comma-separated origins (e.g. the app host and a separate signer
  // host); we allow each one. Falls back to the dev origin when unset.
  const webOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
  app.enableCors({
    origin: webOrigins,
    credentials: true,
    // Let the browser read the artifact filename on cross-origin downloads.
    exposedHeaders: ['Content-Disposition'],
  });
  app.setGlobalPrefix('api', { exclude: ['health'] });

  // Validate + strip unknown properties on every DTO-bound request body.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
