import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { SalesService } from './sales.service';

describe('Messenger and handoff safety boundaries', () => {
  const previousSecret = process.env.META_APP_SECRET;
  const previousVerify = process.env.META_VERIFY_TOKEN;
  afterEach(() => {
    if (previousSecret === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = previousSecret;
    if (previousVerify === undefined) delete process.env.META_VERIFY_TOKEN; else process.env.META_VERIFY_TOKEN = previousVerify;
  });

  function setup() {
    const conversation = { id: 'conversation', pageId: 'page', customerId: 'customer', version: 0, aiEnabled: true, lastCustomerMessageAt: new Date() };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'PAGE_MANAGER', emailVerifiedAt: new Date() }) },
      pageMember: { findUnique: jest.fn().mockResolvedValue({ userId: 'staff', pageId: 'page' }) },
      conversation: {
        findFirst: jest.fn().mockImplementation(async () => conversation),
        update: jest.fn().mockImplementation(async ({ data }: { data: { aiEnabled: boolean; status: string } }) => Object.assign(conversation, data, { version: conversation.version + 1 })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      message: { create: jest.fn().mockResolvedValue({ id: 'out', text: 'Xin chào' }) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
      page: { findUnique: jest.fn().mockResolvedValue({ id: 'page', externalPageId: 'meta-page' }) },
      webhookEvent: { create: jest.fn() },
    };
    const realtime = { emitPage: jest.fn().mockResolvedValue(undefined) };
    const integrations = { sendMessenger: jest.fn() };
    const service = new SalesService(prisma as unknown as PrismaService, realtime as unknown as RealtimeService, integrations as unknown as IntegrationsService);
    return { service, prisma, tx, conversation, integrations };
  }

  it('rejects a missing or forged webhook signature before touching data', async () => {
    process.env.META_APP_SECRET = 'unit-test-secret';
    const { service, prisma } = setup();
    const body = Buffer.from('{"object":"page"}');
    await expect(service.receiveWebhook(body)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.receiveWebhook(body, `sha256=${'0'.repeat(64)}`)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.page.findUnique).not.toHaveBeenCalled();
  });

  it('ignores a signed page echo without creating an inbound event', async () => {
    process.env.META_APP_SECRET = 'unit-test-secret';
    const { service, prisma } = setup();
    const body = Buffer.from(JSON.stringify({ object: 'page', entry: [{ id: 'meta-page', messaging: [{ sender: { id: 'meta-page' }, recipient: { id: 'customer' }, message: { mid: 'echo', is_echo: true, text: 'page reply' } }] }] }));
    const signature = `sha256=${createHmac('sha256', process.env.META_APP_SECRET).update(body).digest('hex')}`;
    await service.receiveWebhook(body, signature);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('verifies challenge and safely rejects a multibyte mismatched token', () => {
    process.env.META_VERIFY_TOKEN = 'abcd';
    const { service } = setup();
    expect(service.verifyWebhook('subscribe', 'abcd', 'challenge')).toBe('challenge');
    expect(() => service.verifyWebhook('subscribe', 'ắắắắ', 'challenge')).toThrow(UnauthorizedException);
  });

  it('commits AI takeover even when a human reply is outside 24 hours', async () => {
    const { service, conversation, tx, integrations } = setup();
    conversation.lastCustomerMessageAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await expect(service.sendHuman('page', 'conversation', 'staff', 'Xin chào')).rejects.toBeInstanceOf(BadRequestException);
    expect(conversation.aiEnabled).toBe(false);
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(integrations.sendMessenger).not.toHaveBeenCalled();
  });

  it('rejects revoked page membership inside the send transaction', async () => {
    const { service, tx, integrations } = setup();
    tx.pageMember.findUnique.mockResolvedValue(null);
    await expect(service.sendHuman('page', 'conversation', 'staff', 'Xin chào')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(integrations.sendMessenger).not.toHaveBeenCalled();
  });
});
