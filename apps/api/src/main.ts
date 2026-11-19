import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
// src/main.ts and dist/main.js are both three directories below the workspace root.
config({ path: resolve(__dirname, '../../../.env') });
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/http-error.filter';

export async function bootstrap() {
  if (!['mock', 'live'].includes(process.env.INTEGRATIONS_MODE || '')) throw new Error('Set INTEGRATIONS_MODE=mock or live explicitly');
  if (Buffer.from(process.env.ENCRYPTION_KEY || '', 'base64').length !== 32) throw new Error('Missing valid ENCRYPTION_KEY; run pnpm setup:env');
  if (process.env.NODE_ENV === 'production' && !process.env.WEB_URL?.startsWith('https://')) throw new Error('Production WEB_URL must use HTTPS');
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: ['log', 'error', 'warn'] });
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: process.env.WEB_URL || 'http://localhost:5173', credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Token'] });
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpErrorFilter());
  const logger = new Logger('HTTP');
  app.use((req: { method: string; path: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; on: (event: string, cb: () => void) => void }, next: () => void) => {
    const started = Date.now(); res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => logger.log(JSON.stringify({ event: 'request', method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started })));
    next();
  });
  const openapi = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('AI Sales Agent').setDescription('Multi-fanpage inbox; cookie session + X-CSRF-Token. Live integrations require explicit credentials.').setVersion('0.1.0').addCookieAuth('session_token').build());
  SwaggerModule.setup('api/docs', app, openapi);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 3000), process.env.API_HOST || '127.0.0.1');
  return app;
}
if (require.main === module) bootstrap().catch(() => { process.stderr.write('API startup failed. Check database, Redis and environment configuration.\n'); process.exitCode = 1; });
