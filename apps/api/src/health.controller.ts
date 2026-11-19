import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { Public } from './auth/public.decorator';
import { PrismaService } from './prisma/prisma.service';
@Controller('health')
export class HealthController {
  constructor(private readonly db: PrismaService) {}
  @Public() @Get() async health() {
    let database = false; let redis = false;
    try { await this.db.$queryRaw`SELECT 1`; database = true; } catch { /* readiness failure */ }
    const client = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:16379', { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 0, retryStrategy: () => null });
    client.on('error', () => undefined);
    try { await client.connect(); redis = await client.ping() === 'PONG'; } catch { /* readiness failure */ } finally { client.disconnect(); }
    const body = { status: database && redis ? 'ok' : 'degraded', database, redis, mode: process.env.INTEGRATIONS_MODE || 'mock', integrationsMode: process.env.INTEGRATIONS_MODE || 'mock' };
    if (!database || !redis) throw new ServiceUnavailableException(body);
    return body;
  }
}
