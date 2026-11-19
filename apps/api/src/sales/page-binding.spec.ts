import { createHmac } from 'node:crypto';
import { SalesService } from './sales.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { IntegrationsService } from '../integrations/integrations.service';

describe('Webhook page identity binding', () => {
  const originalSecret = process.env.META_APP_SECRET;
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = originalSecret;
  });

  function fixture(bindingStillMatches: boolean) {
    process.env.META_APP_SECRET = 'unit-test-signing-key';
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      page: { findFirst: jest.fn().mockResolvedValue(bindingStillMatches ? { id: 'internal-page' } : null) },
      webhookEvent: { create: jest.fn().mockResolvedValue({ id: 'event' }) },
    };
    const prisma = {
      page: { findUnique: jest.fn().mockResolvedValue({ id: 'internal-page' }) },
      $transaction: jest.fn().mockImplementation(async callback => callback(tx)),
    };
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const service = new SalesService(prisma as unknown as PrismaService, {} as RealtimeService, {} as IntegrationsService);
    Object.assign(service, { queue });
    const body = Buffer.from(JSON.stringify({ object: 'page', entry: [{ id: '123456789', messaging: [{ sender: { id: 'customer' }, recipient: { id: '123456789' }, timestamp: Date.now(), message: { mid: 'incoming', text: 'Xin chào shop' } }] }] }));
    const signature = `sha256=${createHmac('sha256', process.env.META_APP_SECRET).update(body).digest('hex')}`;
    return { service, tx, queue, body, signature };
  }

  it('drops an event if the Page ID changed after webhook lookup', async () => {
    const { service, tx, queue, body, signature } = fixture(false);
    await service.receiveWebhook(body, signature);
    expect(tx.page.findFirst).toHaveBeenCalledWith({ where: { id: 'internal-page', externalPageId: '123456789' }, select: { id: true } });
    expect(tx.webhookEvent.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('persists and queues a signed event when the current page binding matches', async () => {
    const { service, tx, queue, body, signature } = fixture(true);
    await service.receiveWebhook(body, signature);
    expect(tx.webhookEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ pageId: 'internal-page', eventKey: '123456789:incoming' }) });
    expect(queue.add).toHaveBeenCalledWith('inbound', { id: 'event' }, { jobId: 'in-event' });
  });
});
