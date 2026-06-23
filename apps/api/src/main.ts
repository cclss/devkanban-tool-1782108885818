import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Captured signature values arrive as base64 image dataURLs, which exceed
  // the 100kb body-parser default. Raise the JSON limit so the signer's
  // `POST /signing/:token/fields` request is accepted.
  app.useBodyParser('json', { limit: '8mb' });
  app.useBodyParser('urlencoded', { limit: '8mb', extended: true });

  // Allow the web app (and signer pages) to call the API during development.
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
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
