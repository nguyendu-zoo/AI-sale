import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { SalesIntent } from '../src/sales/intent';

config({ path: resolve(__dirname, '../../../.env') });
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || new URL(testUrl).pathname !== '/aisales_test') {
  throw new Error('Integration tests require TEST_DATABASE_URL targeting the dedicated aisales_test database.');
}
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.INTEGRATIONS_MODE = 'mock';
process.env.WEB_URL = 'http://localhost:5173';
process.env.APP_URL = process.env.WEB_URL;
// Integration verification mail must stay in the local Mailpit instance, even if .env uses live SMTP.
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '1025';
process.env.SMTP_SECURE = 'false';
process.env.SMTP_USER = '';
process.env.SMTP_PASSWORD = '';
process.env.MAIL_FROM = 'AI Sales Integration <integration@localhost.test>';
const redisUrl = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:16379');
redisUrl.pathname = '/1';
process.env.REDIS_URL = redisUrl.toString();

const run = randomBytes(6).toString('hex');
const password = randomBytes(18).toString('base64url');
const pageId = `test-${run}-a`;
const otherPageId = `test-${run}-b`;
const externalPageId = `9${Date.now()}01`;
const adminEmail = `admin-${run}@test.invalid`;
const managerEmail = `manager-${run}@test.invalid`;
let app: INestApplication;
let db: PrismaClient;
let adapters: IntegrationsService;
let adminCookie = '';
let adminCsrf = '';
let managerCookie = '';
let managerCsrf = '';
let managerId = '';
let productId = '';
const sockets = new Set<Socket>();

type SessionHeaders = { cookie: string; csrf: string };
const admin = (): SessionHeaders => ({ cookie: adminCookie, csrf: adminCsrf });
const manager = (): SessionHeaders => ({ cookie: managerCookie, csrf: managerCsrf });
const authorized = (verb: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, session = admin()) => {
  return request(app.getHttpServer())[verb](`/api${path}`).set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).set('Origin', process.env.WEB_URL!);
};
async function login(email: string): Promise<SessionHeaders> {
  const result = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(201);
  const cookies = result.headers['set-cookie'] as unknown as string[];
  expect(cookies.some(value => value.startsWith('session_token=') && /HttpOnly/i.test(value))).toBe(true);
  expect(cookies.every(value => /SameSite=Lax/i.test(value))).toBe(true);
  const cookie = cookies.map(value => value.split(';')[0]).join('; ');
  const csrf = cookies.find(value => value.startsWith('csrf_token='))!.split(';')[0]!.slice('csrf_token='.length);
  return { cookie, csrf };
}
async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean, description: string, timeout = 15000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) return value;
    await new Promise(done => setTimeout(done, 75));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function simulate(customerId: string, text: string) {
  const result = await authorized('post', `/pages/${pageId}/simulate`).send({ customerId, text }).expect(201);
  await until(() => db.webhookEvent.findUnique({ where: { id: result.body.eventId } }), event => event?.status === 'DONE', `inbound ${result.body.eventId}`);
  return db.conversation.findUniqueOrThrow({ where: { pageId_customerId: { pageId, customerId } }, include: { quotes: { orderBy: { createdAt: 'desc' } }, messages: true } });
}
async function signedWebhook(body: unknown, signature?: string) {
  const raw = JSON.stringify(body);
  const actual = signature ?? `sha256=${createHmac('sha256', process.env.META_APP_SECRET!).update(raw).digest('hex')}`;
  return request(app.getHttpServer()).post('/api/webhooks/messenger').set('Content-Type', 'application/json').set('X-Hub-Signature-256', actual).send(raw);
}
function socketEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((done, reject) => {
    const onEvent = (value: T) => { clearTimeout(timer); done(value); };
    const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`Socket timeout: ${event}`)); }, 5000);
    socket.once(event, onEvent);
  });
}
async function managerSocket(): Promise<Socket> {
  const address = app.getHttpServer().address() as { port: number };
  const socket = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false, extraHeaders: { Cookie: managerCookie, Origin: process.env.WEB_URL! } });
  sockets.add(socket);
  const connected = socketEvent(socket, 'connect'); socket.connect(); await connected;
  return socket;
}

beforeAll(async () => {
  execFileSync(process.execPath, [resolve(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(__dirname, '../prisma/schema.prisma')], { env: process.env, stdio: 'pipe' });
  const { AppModule } = await import('../src/app.module');
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  await app.listen(0, '127.0.0.1');
  db = new PrismaClient();
  adapters = app.get(IntegrationsService);
  await db.user.create({ data: { email: adminEmail, name: 'Integration admin', passwordHash: await hash(password, 4), role: 'SUPER_ADMIN', emailVerifiedAt: new Date() } });
  await db.page.createMany({ data: [{ id: pageId, externalPageId, name: 'Integration MaiSon', settings: { segmentRules: { POPULAR: [0.05, 0.05, 0.02], MID: [0.03], PREMIUM: [0.02] } } }, { id: otherPageId, externalPageId: `${externalPageId}2`, name: 'Integration tenant B' }] });
  const product = await db.product.create({ data: { pageId, sku: `E2E-${run}`, name: 'Bình hoa kiểm thử', segment: 'POPULAR', stock: 20, basePrice: 200000, minPrice: 300000, maxPrice: 340000, description: 'Sản phẩm mock dành riêng cho integration test.' } });
  productId = product.id;
  const session = await login(adminEmail); adminCookie = session.cookie; adminCsrf = session.csrf;
}, 60000);

afterAll(async () => {
  jest.restoreAllMocks();
  for (const socket of sockets) socket.close();
  if (app) await app.close(); // Stop workers before deleting fixtures.
  if (db) {
    await db.auditLog.deleteMany({ where: { OR: [{ pageId: { in: [pageId, otherPageId] } }, { actor: { email: { in: [adminEmail, managerEmail] } } }] } });
    await db.quote.deleteMany({ where: { conversation: { pageId: { in: [pageId, otherPageId] } } } });
    await db.page.deleteMany({ where: { id: { in: [pageId, otherPageId] } } });
    await db.user.deleteMany({ where: { email: { in: [adminEmail, managerEmail] } } });
    await db.$disconnect();
  }
});

describe('Real PostgreSQL + Redis + SMTP with mock external providers', () => {
  test('health checks PostgreSQL/Redis and clearly reports mock mode', async () => {
    const result = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(result.body).toMatchObject({ database: true, redis: true, integrationsMode: 'mock' });
    await request(app.getHttpServer()).get('/api/pages').expect(401);
  });

  test('registration sends SMTP verification, prevents unverified login, consumes token once', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send({ email: managerEmail, password, name: 'Integration manager', role: 'SUPER_ADMIN' }).expect(400);
    await request(app.getHttpServer()).post('/api/auth/register').send({ email: managerEmail, password, name: 'Integration manager' }).expect(201);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: managerEmail, password }).expect(403);
    const mailbox = await until(async () => {
      const response = await fetch('http://localhost:8025/api/v1/messages');
      const data = await response.json() as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
      return data.messages.find(message => message.To.some(to => to.Address === managerEmail));
    }, Boolean, 'real SMTP verification email in Mailpit');
    const mail = await (await fetch(`http://localhost:8025/api/v1/message/${mailbox!.ID}`)).json() as { Text: string };
    const token = mail.Text.match(/token=([a-f0-9]{64})/)?.[1];
    expect(token).toHaveLength(64);
    await request(app.getHttpServer()).post('/api/auth/verify-email').send({ token }).expect(201);
    await request(app.getHttpServer()).post('/api/auth/verify-email').send({ token }).expect(400);
    const session = await login(managerEmail); managerCookie = session.cookie; managerCsrf = session.csrf;
    managerId = (await db.user.findUniqueOrThrow({ where: { email: managerEmail } })).id;
    const me = await authorized('get', '/auth/me', manager()).expect(200);
    expect(me.body.user.role).toBe('PAGE_MANAGER');
    expect(me.body.user.passwordHash).toBeUndefined();
  });

  test('CSRF and cross-origin requests are rejected server-side', async () => {
    await request(app.getHttpServer()).patch(`/api/pages/${pageId}`).set('Cookie', adminCookie).send({ aiEnabled: false }).expect(403);
    await authorized('patch', `/pages/${pageId}`).set('Origin', 'https://attacker.invalid').send({ aiEnabled: false }).expect(403);
    await request(app.getHttpServer()).post('/api/auth/login').set('Origin', 'https://attacker.invalid').send({ email: adminEmail, password }).expect(403);
    expect((await db.page.findUniqueOrThrow({ where: { id: pageId } })).aiEnabled).toBe(true);
  });

  test('new manager has no pages; only admin grants exactly the assigned tenant', async () => {
    expect((await authorized('get', '/pages', manager()).expect(200)).body).toEqual([]);
    await authorized('get', `/pages/${pageId}/products`, manager()).expect(403);
    await authorized('get', '/users', manager()).expect(403);
    await authorized('put', `/pages/${pageId}/members/${managerId}`, manager()).expect(403);
    await authorized('put', `/pages/${pageId}/members/${managerId}`).expect(200);
    const pages = await authorized('get', '/pages', manager()).expect(200);
    expect(pages.body.map((page: { id: string }) => page.id)).toEqual([pageId]);
    await authorized('get', `/pages/${pageId}/products`, manager()).expect(200);
    await authorized('get', `/pages/${otherPageId}/products`, manager()).expect(403);
    await authorized('patch', `/pages/${pageId}`, manager()).send({ aiEnabled: false }).expect(403);
    expect(await db.auditLog.count({ where: { pageId, action: 'PAGE_ACCESS_GRANTED' } })).toBe(1);
  });

  test('admin can save the seeded demo metadata and sheet mapping without losing configuration', async () => {
    const settings = { demo: true, sheet: { spreadsheetId: '', tab: 'Products', mapping: { sku: 'SKU', name: 'Tên sản phẩm', basePrice: 'Giá gốc' } }, segmentRules: { POPULAR: [0.05], MID: [0.03], PREMIUM: [0.02] } };
    const saved = await authorized('patch', `/pages/${pageId}`).send({ settings }).expect(200);
    expect(saved.body.settings).toEqual(settings);
    const loaded = await db.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(loaded.settings).toEqual(settings);
    // Restore the pricing fixture's three negotiation steps for subsequent scenarios.
    await authorized('patch', `/pages/${pageId}`).send({ settings: { ...settings, segmentRules: { POPULAR: [0.05, 0.05, 0.02], MID: [0.03], PREMIUM: [0.02] } } }).expect(200);
  });

  test('integration tokens are encrypted at rest and never returned by API', async () => {
    const localToken = randomBytes(24).toString('hex');
    const result = await authorized('patch', `/pages/${pageId}`).send({ messengerToken: localToken }).expect(200);
    const stored = await db.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(stored.messengerTokenEnc).toMatch(/^v1:/);
    expect(stored.messengerTokenEnc).not.toContain(localToken);
    expect(JSON.stringify(result.body)).not.toContain(localToken);
    expect(result.body.messengerTokenEnc).toBeUndefined();
    expect(result.body.messengerConfigured).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { pageId, action: 'PAGE_UPDATED' } });
    expect(JSON.stringify(audit.metadata)).not.toContain(localToken);
  });

  test('webhook verification checks token and HMAC; duplicate messages and echoes are ignored', async () => {
    await request(app.getHttpServer()).get('/api/webhooks/messenger').query({ 'hub.mode': 'subscribe', 'hub.verify_token': process.env.META_VERIFY_TOKEN, 'hub.challenge': '12345' }).expect(200, '12345');
    await request(app.getHttpServer()).get('/api/webhooks/messenger').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' }).expect(401);
    await request(app.getHttpServer()).post('/api/webhooks/messenger').send({ object: 'page' }).expect(401);
    const mid = `mid-${run}`;
    const body = { object: 'page', entry: [{ id: externalPageId, messaging: [{ sender: { id: `webhook-${run}` }, recipient: { id: externalPageId }, timestamp: Date.now(), message: { mid, text: `Giá E2E-${run} bao nhiêu?` } }] }] };
    const invalid = await signedWebhook(body, `sha256=${'0'.repeat(64)}`); expect(invalid.status).toBe(401);
    const first = await signedWebhook(body); expect(first.status).toBe(200);
    const duplicate = await signedWebhook(body); expect(duplicate.status).toBe(200);
    await until(() => db.webhookEvent.findUnique({ where: { eventKey: `${externalPageId}:${mid}` } }), event => event?.status === 'DONE', 'signed webhook worker');
    expect(await db.webhookEvent.count({ where: { eventKey: `${externalPageId}:${mid}` } })).toBe(1);
    expect(await db.message.count({ where: { externalId: `${externalPageId}:${mid}:in` } })).toBe(1);
    const echo = { object: 'page', entry: [{ id: externalPageId, messaging: [{ sender: { id: externalPageId }, recipient: { id: `webhook-${run}` }, timestamp: Date.now(), message: { mid: `${mid}-echo`, text: 'Echo', is_echo: true } }] }] };
    expect((await signedWebhook(echo)).status).toBe(200);
    expect(await db.webhookEvent.count({ where: { eventKey: `${externalPageId}:${mid}-echo` } })).toBe(0);
  });

  test('pricing stays unchanged without bargaining and never crosses configured floor', async () => {
    const customerId = `pricing-${run}`;
    let conversation = await simulate(customerId, `Cho tôi hỏi E2E-${run}`);
    expect(conversation.quotes[0]!.amount).toBe(340000);
    conversation = await simulate(customerId, 'Kích thước sản phẩm thế nào?');
    expect(conversation.quotes[0]!.amount).toBe(340000);
    conversation = await simulate(customerId, 'Shop giảm giá giúp tôi');
    expect(conversation.quotes[0]!.amount).toBe(323000);
    for (let step = 0; step < 5; step++) conversation = await simulate(customerId, 'Giảm thêm giúp tôi');
    expect(conversation.quotes[0]!.amount).toBe(300000);
    expect(conversation.quotes.every(quote => quote.amount >= quote.floor)).toBe(true);
    conversation = await simulate(customerId, '250k được không?');
    expect(conversation).toMatchObject({ aiEnabled: false, status: 'NEEDS_HUMAN', handoffReason: 'OFFER_BELOW_FLOOR' });
  });

  test('purchase becomes pending staff confirmation and sends only a mock Telegram notification', async () => {
    const customerId = `purchase-${run}`;
    await simulate(customerId, `Tư vấn E2E-${run}`);
    const conversation = await simulate(customerId, 'Tôi đồng ý mua');
    expect(conversation).toMatchObject({ aiEnabled: false, status: 'WAITING_CONFIRMATION', handoffReason: 'PURCHASE_CONFIRMATION' });
    const notification = await until(() => db.notification.findFirst({ where: { conversationId: conversation.id } }), item => item?.status === 'SENT', 'mock Telegram notification');
    expect(notification!.error).toContain('MOCK');
    expect(conversation.messages.some(message => message.text.includes('chưa được tạo'))).toBe(true);
    const wrongTenant = await db.conversation.create({ data: { pageId: otherPageId, customerId: `other-${run}` } });
    await authorized('get', `/pages/${pageId}/conversations/${wrongTenant.id}`, manager()).expect(404);
    await authorized('post', `/pages/${pageId}/conversations/${wrongTenant.id}/takeover`, manager()).expect(404);
    await authorized('get', `/pages/${otherPageId}/conversations/${wrongTenant.id}`, manager()).expect(403);
  });

  test('a delayed bargaining webhook is kept as history without changing the current quote', async () => {
    const customerId = `delayed-${run}`;
    const current = await simulate(customerId, `Tư vấn E2E-${run}`);
    expect(current.quotes).toHaveLength(1);
    const outboundBefore = current.messages.filter(message => message.direction === 'OUTBOUND').length;
    const mid = `delayed-mid-${run}`;
    const timestamp = Date.now() - 60_000;
    const body = { object: 'page', entry: [{ id: externalPageId, messaging: [{ sender: { id: customerId }, recipient: { id: externalPageId }, timestamp, message: { mid, text: 'Shop giảm giá giúp tôi' } }] }] };
    expect((await signedWebhook(body)).status).toBe(200);
    await until(() => db.webhookEvent.findUnique({ where: { eventKey: `${externalPageId}:${mid}` } }), event => event?.status === 'DONE', 'delayed bargaining webhook');
    const updated = await db.conversation.findUniqueOrThrow({ where: { id: current.id }, include: { quotes: true, messages: true } });
    expect(updated.quotes).toHaveLength(1);
    expect(updated.quotes[0]!.amount).toBe(current.quotes[0]!.amount);
    expect(updated.messages.filter(message => message.direction === 'OUTBOUND')).toHaveLength(outboundBefore);
    expect(updated.lastCustomerMessageAt).toEqual(current.lastCustomerMessageAt);
    const delayed = updated.messages.find(message => message.externalId === `${externalPageId}:${mid}:in`);
    expect(delayed?.createdAt.getTime()).toBe(timestamp);
    expect(await db.auditLog.count({ where: { pageId, action: 'DELAYED_INBOUND_STORED', metadata: { path: ['conversationId'], equals: current.id } } })).toBe(1);
  });

  test('Page AI off saves inbound messages without sending any AI response', async () => {
    await authorized('patch', `/pages/${pageId}`).send({ aiEnabled: false }).expect(200);
    try {
      const conversation = await simulate(`off-${run}`, `Cho hỏi E2E-${run}`);
      expect(conversation.messages.filter(message => message.direction === 'INBOUND')).toHaveLength(1);
      expect(conversation.messages.filter(message => message.sender === 'AI')).toHaveLength(0);
      expect(conversation.quotes).toHaveLength(0);
    } finally { await authorized('patch', `/pages/${pageId}`).send({ aiEnabled: true }).expect(200); }
  });

  test('human takeover fences an AI response already waiting for classification', async () => {
    let release!: (intent: SalesIntent) => void;
    let started!: () => void;
    const waiting = new Promise<void>(done => { started = done; });
    const classified = new Promise<SalesIntent>(done => { release = done; });
    const spy = jest.spyOn(adapters, 'classify').mockImplementationOnce(async () => { started(); return classified; });
    const customerId = `race-${run}`;
    try {
      const queued = await authorized('post', `/pages/${pageId}/simulate`).send({ customerId, text: `Cho hỏi E2E-${run}` }).expect(201);
      let classifyTimer: NodeJS.Timeout | undefined;
      try { await Promise.race([waiting, new Promise((_, reject) => { classifyTimer = setTimeout(() => reject(new Error('classify did not start')), 10000); })]); }
      finally { clearTimeout(classifyTimer); }
      const conversation = await db.conversation.findUniqueOrThrow({ where: { pageId_customerId: { pageId, customerId } } });
      await authorized('post', `/pages/${pageId}/conversations/${conversation.id}/takeover`, manager()).expect(201);
      release({ intent: 'PRODUCT', productId, offeredPrice: null, tone: 'FRIENDLY' });
      await until(() => db.webhookEvent.findUnique({ where: { id: queued.body.eventId } }), event => event?.status === 'DONE', 'takeover race event');
      expect(await db.message.count({ where: { conversationId: conversation.id, sender: 'AI' } })).toBe(0);
      expect(await db.quote.count({ where: { conversationId: conversation.id } })).toBe(0);
      expect((await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).aiEnabled).toBe(false);
      await authorized('post', `/pages/${pageId}/conversations/${conversation.id}/reply`, manager()).send({ text: 'Nhân viên đang hỗ trợ bạn.' }).expect(201);
      expect(await db.message.count({ where: { conversationId: conversation.id, sender: 'HUMAN', deliveryStatus: 'SENT' } })).toBe(1);
      await authorized('patch', `/pages/${pageId}/conversations/${conversation.id}/ai`, manager()).send({ enabled: true }).expect(200);
      expect((await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).aiEnabled).toBe(true);
    } finally { release?.({ intent: 'HUMAN', productId: null, offeredPrice: null, tone: 'POLITE' }); spy.mockRestore(); }
  });

  test('expired 24h messaging window blocks both AI and manual Send API calls', async () => {
    const customerId = `expired-${run}`;
    const mid = `expired-mid-${run}`;
    const body = { object: 'page', entry: [{ id: externalPageId, messaging: [{ sender: { id: customerId }, recipient: { id: externalPageId }, timestamp: Date.now() - 25 * 3600000, message: { mid, text: `Tư vấn E2E-${run}` } }] }] };
    expect((await signedWebhook(body)).status).toBe(200);
    await until(() => db.webhookEvent.findUnique({ where: { eventKey: `${externalPageId}:${mid}` } }), event => event?.status === 'DONE', 'expired window event');
    const conversation = await db.conversation.findUniqueOrThrow({ where: { pageId_customerId: { pageId, customerId } } });
    expect(conversation.handoffReason).toBe('OUTSIDE_MESSAGING_WINDOW');
    expect(await db.message.count({ where: { conversationId: conversation.id, direction: 'OUTBOUND' } })).toBe(0);
    await authorized('post', `/pages/${pageId}/conversations/${conversation.id}/reply`, manager()).send({ text: 'Tin ngoài cửa sổ' }).expect(400);
    expect(await db.message.count({ where: { conversationId: conversation.id, direction: 'OUTBOUND' } })).toBe(0);
  });

  test('unsafe product data and explicit human requests always hand off', async () => {
    await db.product.create({ data: { pageId, sku: `UNSAFE-${run}`, name: 'Sản phẩm thiếu sàn', segment: 'MID', maxPrice: 100000 } });
    const unsafe = await simulate(`unsafe-${run}`, `UNSAFE-${run}`);
    expect(unsafe).toMatchObject({ aiEnabled: false, handoffReason: 'UNSAFE_PRICE_DATA', status: 'NEEDS_HUMAN' });
    expect(unsafe.quotes).toHaveLength(0);
    const human = await simulate(`human-${run}`, 'Tôi muốn gặp nhân viên');
    expect(human).toMatchObject({ aiEnabled: false, handoffReason: 'CUSTOMER_REQUESTED_HUMAN', status: 'NEEDS_HUMAN' });
  });

  test('Telegram outage retries while handoff stays visible and excludes customer PII', async () => {
    await until(() => db.notification.count({ where: { pageId, status: 'PENDING' } }), count => count === 0, 'prior notifications');
    const spy = jest.spyOn(adapters, 'notifyTelegram').mockRejectedValueOnce(new Error('simulated Telegram outage'));
    const customerId = `private-${run}`;
    try {
      const conversation = await simulate(customerId, 'Tôi tên Khách Riêng, số 0901234567, muốn gặp nhân viên');
      const failed = await until(() => db.notification.findFirst({ where: { conversationId: conversation.id } }), item => item?.status === 'FAILED', 'failed Telegram attempt');
      expect(failed!.attempts).toBe(1);
      const inbox = await authorized('get', `/pages/${pageId}/conversations?status=NEEDS_HUMAN`, manager()).expect(200);
      expect(inbox.body.some((item: { id: string }) => item.id === conversation.id)).toBe(true);
      const retried = await until(() => db.notification.findFirst({ where: { conversationId: conversation.id } }), item => item?.status === 'SENT', 'Telegram retry');
      expect(retried!.attempts).toBe(2);
      const notificationText = spy.mock.calls.find(([, text]) => text.includes(conversation.id))?.[1];
      expect(notificationText).toContain('Integration MaiSon');
      expect(notificationText).toContain('http://localhost:5173/inbox?');
      expect(notificationText).not.toContain(customerId);
      expect(notificationText).not.toContain('0901234567');
      expect(notificationText).not.toContain('Khách Riêng');
    } finally { spy.mockRestore(); }
  });

  test('mock Sheets sync records freshness; provider failure preserves catalog cache', async () => {
    const sync = await authorized('post', `/pages/${pageId}/sync`).expect(201);
    expect(sync.body).toMatchObject({ mode: 'mock', count: 3 });
    const old = await db.product.findMany({ where: { pageId, active: true } });
    expect(old).toHaveLength(3);
    const spy = jest.spyOn(adapters, 'readSheet').mockRejectedValueOnce(new Error('simulated outage'));
    try {
      await authorized('post', `/pages/${pageId}/sync`).expect(400);
      expect(await db.product.findMany({ where: { pageId, active: true } })).toEqual(old);
      const page = await db.page.findUniqueOrThrow({ where: { id: pageId } });
      expect(page.syncError).toBeTruthy(); expect(page.lastSyncedAt).not.toBeNull();
    } finally { spy.mockRestore(); }
  });

  test('revocation takes effect on existing sessions; logout invalidates session', async () => {
    const socket = await managerSocket();
    const joined = await new Promise<{ joined: string }>((done, reject) => socket.timeout(5000).emit('join_page', { pageId }, (error: Error | null, response: { joined: string }) => error ? reject(error) : done(response)));
    expect(joined.joined).toBe(pageId);
    const deniedTenant = socketEvent(socket, 'exception');
    socket.emit('join_page', { pageId: otherPageId });
    expect(await deniedTenant).toMatchObject({ status: 'error' });
    const revoked = socketEvent(socket, 'access_revoked');
    await authorized('delete', `/pages/${pageId}/members/${managerId}`).expect(200);
    expect(await revoked).toEqual({ pageId });
    const deniedRevoked = socketEvent(socket, 'exception');
    socket.emit('join_page', { pageId });
    expect(await deniedRevoked).toMatchObject({ status: 'error' });
    await authorized('get', `/pages/${pageId}/conversations`, manager()).expect(403);
    expect((await authorized('get', '/pages', manager()).expect(200)).body).toEqual([]);
    expect(await db.auditLog.count({ where: { pageId, action: 'PAGE_ACCESS_REVOKED' } })).toBe(1);
    await authorized('post', '/auth/logout', manager()).expect(201);
    await authorized('get', '/auth/me', manager()).expect(401);
    socket.close(); sockets.delete(socket);
  });
});
