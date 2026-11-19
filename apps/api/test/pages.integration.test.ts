import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { CommonModule, EncryptionService } from '../src/common/encryption.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { PagesController } from '../src/pages/pages.controller';
import { PrismaModule } from '../src/prisma/prisma.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { SalesService } from '../src/sales/sales.service';

config({ path: resolve(__dirname, '../../../.env') });
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || new URL(testUrl).pathname !== '/aisales_test') throw new Error('Page binding tests require the dedicated aisales_test database.');
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.INTEGRATIONS_MODE = 'mock';
process.env.WEB_URL = 'http://localhost:5173';

const run = randomBytes(6).toString('hex');
const password = randomBytes(24).toString('base64url');
const adminEmail = `page-admin-${run}@test.invalid`;
const managerEmail = `page-manager-${run}@test.invalid`;
const pageId = `binding-${run}-main`;
const otherId = `binding-${run}-other`;
const historyId = `binding-${run}-history`;
const webhookId = `binding-${run}-webhook`;
const externalId = `8${Date.now()}01`;
const otherExternalId = `${externalId}2`;
const firstReplacementId = `${externalId}3`;
const secondReplacementId = `${externalId}4`;
const pageIds = new Set([pageId, otherId, historyId, webhookId]);
const oldToken = randomBytes(24).toString('hex');
const newToken = randomBytes(24).toString('hex');
let app: INestApplication;
let db: PrismaClient;
let encryption: EncryptionService;
let managerId: string;
let productId: string;
type Session = { cookie: string; csrf: string };
let admin: Session;
let manager: Session;

async function login(email: string): Promise<Session> {
  const result = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(201);
  const cookies = result.headers['set-cookie'] as unknown as string[];
  return { cookie: cookies.map(value => value.split(';')[0]).join('; '), csrf: cookies.find(value => value.startsWith('csrf_token='))!.split(';')[0]!.slice('csrf_token='.length) };
}
function authorized(method: 'get' | 'post' | 'patch', path: string, session = admin) {
  return request(app.getHttpServer())[method](`/api${path}`).set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).set('Origin', process.env.WEB_URL!);
}

beforeAll(async () => {
  execFileSync(process.execPath, [resolve(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(__dirname, '../prisma/schema.prisma')], { env: process.env, stdio: 'pipe' });
  const module = await Test.createTestingModule({
    imports: [PrismaModule, CommonModule, AuthModule],
    controllers: [PagesController],
    providers: [
      { provide: RealtimeService, useValue: { emitPage: jest.fn().mockResolvedValue(undefined), revoke: jest.fn().mockResolvedValue(undefined) } },
      { provide: SalesService, useValue: {} },
    ],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  db = new PrismaClient();
  encryption = app.get(EncryptionService);
  await db.user.create({ data: { email: adminEmail, name: 'Page binding admin', role: 'SUPER_ADMIN', passwordHash: await hash(password, 4), emailVerifiedAt: new Date() } });
  managerId = (await db.user.create({ data: { email: managerEmail, name: 'Page binding manager', role: 'PAGE_MANAGER', passwordHash: await hash(password, 4), emailVerifiedAt: new Date() } })).id;
  await db.page.createMany({ data: [
    { id: pageId, name: 'Binding original', externalPageId: externalId, aiEnabled: true, messengerTokenEnc: encryption.encrypt(oldToken), settings: { demo: true } },
    { id: otherId, name: 'Other tenant', externalPageId: otherExternalId },
    { id: historyId, name: 'History tenant', externalPageId: `${externalId}5` },
    { id: webhookId, name: 'Webhook tenant', externalPageId: `${externalId}6` },
  ] });
  await db.pageMember.create({ data: { pageId, userId: managerId } });
  productId = (await db.product.create({ data: { pageId, sku: `BIND-${run}`, name: 'Unchanged product', basePrice: 200000, active: true } })).id;
  await db.conversation.create({ data: { pageId: historyId, customerId: `history-${run}` } });
  await db.webhookEvent.create({ data: { pageId: webhookId, eventKey: `binding-event-${run}`, payload: {}, status: 'DONE' } });
  admin = await login(adminEmail);
  manager = await login(managerEmail);
}, 60000);

afterAll(async () => {
  if (app) await app.close();
  if (db) {
    await db.auditLog.deleteMany({ where: { pageId: { in: [...pageIds] } } });
    await db.page.deleteMany({ where: { id: { in: [...pageIds] } } });
    await db.user.deleteMany({ where: { email: { in: [adminEmail, managerEmail] } } });
    await db.$disconnect();
  }
});

describe('Super Admin page identity updates with real PostgreSQL and auth', () => {
  test('name-only edit trims input and preserves binding, Messenger token and AI state', async () => {
    const result = await authorized('patch', `/pages/${pageId}`).send({ name: '  MaiSon revised  ' }).expect(200);
    expect(result.body).toMatchObject({ name: 'MaiSon revised', externalPageId: externalId, aiEnabled: true, messengerConfigured: true });
    expect(encryption.decrypt((await db.page.findUniqueOrThrow({ where: { id: pageId } })).messengerTokenEnc!)).toBe(oldToken);
  });

  test('supported AI instructions survive a settings round trip and validation stays strict', async () => {
    const settings = { demo: true, aiInstructions: 'Advise using the approved product catalogue.' };
    await authorized('patch', `/pages/${pageId}`).send({ settings }).expect(200);
    const listed = await authorized('get', '/pages').expect(200);
    const selected = listed.body.find((page: { id: string }) => page.id === pageId);
    expect(selected.settings).toEqual(settings);
    await authorized('patch', `/pages/${pageId}`).send({ name: 'MaiSon revised', settings: selected.settings }).expect(200);
    expect((await db.page.findUniqueOrThrow({ where: { id: pageId } })).settings).toEqual(settings);
    await authorized('patch', `/pages/${pageId}`).send({ settings: { aiInstructions: 'x'.repeat(2001) } }).expect(400);
    await authorized('patch', `/pages/${pageId}`).send({ settings: { unsupportedSetting: true } }).expect(400);
    expect((await db.page.findUniqueOrThrow({ where: { id: pageId } })).settings).toEqual(settings);
  });

  test('manager only sees assigned pages and cannot read or modify private settings', async () => {
    const result = await authorized('get', '/pages', manager).expect(200);
    expect(result.body.map((page: { id: string }) => page.id)).toEqual([pageId]);
    expect(result.body[0].settings).toEqual({});
    expect(result.body[0].messengerTokenEnc).toBeUndefined();
    await authorized('patch', `/pages/${pageId}`, manager).send({ settings: { aiInstructions: 'Changed by manager' } }).expect(403);
    expect((await db.page.findUniqueOrThrow({ where: { id: pageId } })).settings).toMatchObject({ aiInstructions: 'Advise using the approved product catalogue.' });
  });

  test('empty, null, URL and non-string IDs are rejected without modifying the page', async () => {
    for (const value of ['', '   ', null, 12345, 'https://facebook.com/example']) {
      await authorized('patch', `/pages/${pageId}`).send({ externalPageId: value }).expect(400);
    }
    await authorized('patch', `/pages/${pageId}`).send({ name: '  ' }).expect(400);
    await authorized('patch', `/pages/${pageId}`).send({ name: null }).expect(400);
    expect((await db.page.findUniqueOrThrow({ where: { id: pageId } })).externalPageId).toBe(externalId);
  });

  test('manager with membership cannot change identity and admin still needs CSRF', async () => {
    await authorized('patch', `/pages/${pageId}`, manager).send({ externalPageId: firstReplacementId }).expect(403);
    await request(app.getHttpServer()).patch(`/api/pages/${pageId}`).set('Cookie', admin.cookie).send({ externalPageId: firstReplacementId }).expect(403);
    expect((await db.page.findUniqueOrThrow({ where: { id: pageId } })).externalPageId).toBe(externalId);
  });

  test('admin can replace an unused demo ID while preserving internal page ID, products and memberships', async () => {
    const result = await authorized('patch', `/pages/${pageId}`).send({ externalPageId: `  ${firstReplacementId}  `, aiEnabled: true }).expect(200);
    expect(result.body).toMatchObject({ id: pageId, externalPageId: firstReplacementId, aiEnabled: false, messengerConfigured: false });
    const page = await db.page.findUniqueOrThrow({ where: { id: pageId }, include: { members: true, products: true } });
    expect(page.messengerTokenEnc).toBeNull();
    expect(page.members.map(member => member.userId)).toEqual([managerId]);
    expect(page.products.map(product => product.id)).toEqual([productId]);
    expect(page.products[0]!.active).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { pageId, metadata: { path: ['externalPageIdChange', 'to'], equals: firstReplacementId } } });
    expect(audit.metadata).toMatchObject({ externalPageIdChange: { from: externalId, to: firstReplacementId }, aiPaused: true, messengerTokenCleared: true });
    expect(JSON.stringify(audit.metadata)).not.toContain(oldToken);
  });

  test('submitting the same trimmed ID does not reset a configured token or pause AI', async () => {
    await authorized('patch', `/pages/${pageId}`).send({ messengerToken: newToken, aiEnabled: true }).expect(200);
    const result = await authorized('patch', `/pages/${pageId}`).send({ externalPageId: ` ${firstReplacementId} `, aiEnabled: true }).expect(200);
    expect(result.body).toMatchObject({ aiEnabled: true, messengerConfigured: true, externalPageId: firstReplacementId });
    expect(encryption.decrypt((await db.page.findUniqueOrThrow({ where: { id: pageId } })).messengerTokenEnc!)).toBe(newToken);
  });

  test('new Page ID with a replacement token still pauses AI and encrypts the new token', async () => {
    const result = await authorized('patch', `/pages/${pageId}`).send({ externalPageId: secondReplacementId, messengerToken: ` ${newToken} `, aiEnabled: true }).expect(200);
    expect(result.body).toMatchObject({ aiEnabled: false, messengerConfigured: true, externalPageId: secondReplacementId });
    expect(result.body.messengerTokenEnc).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain(newToken);
    const stored = await db.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(stored.messengerTokenEnc).not.toBe(newToken);
    expect(encryption.decrypt(stored.messengerTokenEnc!)).toBe(newToken);
  });

  test('duplicate Page ID returns a clear 409 and rolls back every submitted field', async () => {
    const before = await db.page.findUniqueOrThrow({ where: { id: pageId } });
    const result = await authorized('patch', `/pages/${pageId}`).send({ externalPageId: otherExternalId, name: 'Must not persist', messengerToken: 'must-not-persist' }).expect(409);
    expect(result.body.message).toContain('đã được gắn');
    const after = await db.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(after).toEqual(before);
  });

  test('conversation history prevents rebinding but still permits page name changes', async () => {
    const before = await db.page.findUniqueOrThrow({ where: { id: historyId } });
    const blocked = await authorized('patch', `/pages/${historyId}`).send({ externalPageId: `${externalId}7` }).expect(409);
    expect(blocked.body.message).toContain('lịch sử');
    expect((await db.page.findUniqueOrThrow({ where: { id: historyId } })).externalPageId).toBe(before.externalPageId);
    expect(await db.conversation.count({ where: { pageId: historyId } })).toBe(1);
    await authorized('patch', `/pages/${historyId}`).send({ name: 'History renamed' }).expect(200);
    await authorized('patch', `/pages/${historyId}`).send({ externalPageId: before.externalPageId }).expect(200);
  });

  test('persisted webhook history also prevents rebinding before a conversation exists', async () => {
    const result = await authorized('patch', `/pages/${webhookId}`).send({ externalPageId: `${externalId}8` }).expect(409);
    expect(result.body.message).toContain('webhook');
    expect(await db.webhookEvent.count({ where: { pageId: webhookId } })).toBe(1);
  });

  test('live mode accepts numeric IDs and rejects mock IDs without contacting Meta', async () => {
    process.env.INTEGRATIONS_MODE = 'live';
    try {
      await authorized('patch', `/pages/${pageId}`).send({ externalPageId: secondReplacementId }).expect(200);
      await authorized('patch', `/pages/${pageId}`).send({ externalPageId: `mock-${run}` }).expect(400);
      await authorized('post', '/pages').send({ name: 'Live invalid', externalPageId: `mock-${run}` }).expect(400);
    } finally { process.env.INTEGRATIONS_MODE = 'mock'; }
  });

  test('creating a page trims fields and duplicate creation returns a useful conflict', async () => {
    const externalPageId = `mock-created-${run}`;
    const created = await authorized('post', '/pages').send({ name: '  Created page  ', externalPageId: ` ${externalPageId} ` }).expect(201);
    pageIds.add(created.body.id);
    expect(created.body).toMatchObject({ name: 'Created page', externalPageId });
    const duplicate = await authorized('post', '/pages').send({ name: 'Duplicate page', externalPageId }).expect(409);
    expect(duplicate.body.message).toContain('đã được gắn');
  });
});
