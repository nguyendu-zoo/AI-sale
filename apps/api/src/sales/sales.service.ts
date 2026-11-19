import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { IntegrationsService, PageSettings } from '../integrations/integrations.service';
import { negotiate, resolvePrice } from './pricing';
import { extractOfferedPrice, isBargainingRequest, mockIntent, SalesIntent } from './intent';
import { FOLLOW_UPS, safeProductAdvice } from './advice';
import { parseMessengerPayload } from './webhook-payload';

interface Inbound { customerId: string; customerName?: string; text: string; timestamp: number }
type Tx = Prisma.TransactionClient;
type Prepared = { messageId: string; conversationId: string; pageId: string; version: number; customerId: string; text: string; handoff: boolean; notificationId?: string; actorId?: string };

@Injectable()
export class SalesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SalesService.name);
  private queue!: Queue;
  private worker!: Worker;
  private recovery?: NodeJS.Timeout;
  private syncTimer?: NodeJS.Timeout;
  private recovering = false;

  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeService, private readonly integrations: IntegrationsService) {}

  async onModuleInit(): Promise<void> {
    const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:16379');
    const connection = { host: url.hostname, port: Number(url.port || 6379), username: url.username || undefined, password: url.password || undefined, db: Number(url.pathname.slice(1) || 0), maxRetriesPerRequest: null, ...(url.protocol === 'rediss:' ? { tls: {} } : {}) };
    this.queue = new Queue('sales', { connection, defaultJobOptions: { attempts: 4, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 500, removeOnFail: 1000 } });
    // A global Redis limit preserves inbound ordering even if more than one API process is started.
    await this.queue.setGlobalConcurrency(1);
    this.worker = new Worker('sales', async (job) => {
      if (job.name === 'inbound') return this.processInbound(String(job.data.id));
      if (job.name === 'notification') return this.processNotification(String(job.data.id));
    }, { connection, concurrency: 1, lockDuration: 90_000 });
    this.worker.on('failed', (job) => this.logger.warn(JSON.stringify({ event: 'queue_job_failed', jobId: job?.id, type: job?.name })));
    this.worker.on('error', () => this.logger.error(JSON.stringify({ event: 'queue_connection_error' })));
    this.queue.on('error', () => this.logger.error(JSON.stringify({ event: 'queue_connection_error' })));
    this.recovery = setInterval(() => void this.recover().catch(() => this.logger.warn('Queue recovery postponed')), 60_000);
    this.syncTimer = setInterval(() => void this.syncConfiguredPages(), Number(process.env.SHEETS_SYNC_INTERVAL_MS ?? 300_000));
    this.recovery.unref(); this.syncTimer.unref();
    await this.recover();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.recovery); clearInterval(this.syncTimer);
    await this.worker?.close(); await this.queue?.close();
  }

  private async recover(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    try {
      const events = await this.prisma.webhookEvent.findMany({ where: { status: { in: ['PENDING', 'PROCESSING', 'FAILED'] }, attempts: { lt: 4 } }, take: 100 });
      for (const event of events) await this.queue.add('inbound', { id: event.id }, { jobId: `in-${event.id}` });
      const notices = await this.prisma.notification.findMany({ where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 4 } }, take: 100 });
      for (const notice of notices) await this.queue.add('notification', { id: notice.id }, { jobId: `note-${notice.id}` });
    } finally { this.recovering = false; }
  }

  private async syncConfiguredPages(): Promise<void> {
    const pages = await this.prisma.page.findMany();
    for (const page of pages) {
      if (!(page.settings as PageSettings).sheet?.spreadsheetId) continue;
      try { await this.syncPage(page.id); } catch { /* syncError stays visible on dashboard */ }
    }
  }

  verifyWebhook(mode?: string, token?: string, challenge?: string): string {
    const expected = process.env.META_VERIFY_TOKEN;
    if (!expected || mode !== 'subscribe' || !token || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      throw new UnauthorizedException('Webhook verify token không hợp lệ.');
    }
    if (!challenge || challenge.length > 1024) throw new BadRequestException('Thiếu challenge.');
    return challenge;
  }

  async receiveWebhook(rawBody: Buffer, signature?: string): Promise<void> {
    const secret = process.env.META_APP_SECRET;
    if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) throw new UnauthorizedException('Webhook thiếu chữ ký hợp lệ.');
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const actual = Buffer.from(signature.slice(7), 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UnauthorizedException('Webhook signature không hợp lệ.');
    for (const event of parseMessengerPayload(rawBody)) {
      const page = await this.prisma.page.findUnique({ where: { externalPageId: event.externalPageId } });
      if (!page) continue;
      await this.persistInbound(page.id, event.eventKey, { customerId: event.customerId, text: event.text, timestamp: event.timestamp }, event.externalPageId);
    }
  }

  private async persistInbound(pageId: string, eventKey: string, inbound: Inbound, expectedExternalPageId?: string): Promise<{ eventId: string } | null> {
    let event;
    try {
      event = await this.prisma.$transaction(async tx => {
        // Serialize first event persistence with Page ID changes. This separate lock
        // does not delay webhook acknowledgement behind the normal send lock.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'page-binding:' + pageId}))`;
        if (expectedExternalPageId && !await tx.page.findFirst({ where: { id: pageId, externalPageId: expectedExternalPageId }, select: { id: true } })) return null;
        return tx.webhookEvent.create({ data: { pageId, eventKey, payload: inbound as unknown as Prisma.InputJsonValue } });
      });
    }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const prior = await this.prisma.webhookEvent.findUniqueOrThrow({ where: { eventKey } });
        return { eventId: prior.id };
      }
      throw error;
    }
    if (!event) return null;
    // A DB-backed pending event survives a Redis outage; recovery enqueues it later.
    try { await this.queue.add('inbound', { id: event.id }, { jobId: `in-${event.id}` }); }
    catch { this.logger.warn(JSON.stringify({ event: 'webhook_persisted_queue_pending', eventId: event.id })); }
    return { eventId: event.id };
  }

  async simulate(pageId: string, input: { customerId: string; text: string; customerName?: string }): Promise<{ eventId: string; mode: string }> {
    if (!this.integrations.mock) throw new BadRequestException('Mô phỏng chỉ khả dụng trong chế độ mock.');
    if (!input.customerId || !input.text || input.text.length > 10_000) throw new BadRequestException('Cần customerId và tin nhắn (tối đa 10.000 ký tự).');
    if (!await this.prisma.page.findUnique({ where: { id: pageId } })) throw new NotFoundException('Không tìm thấy fanpage.');
    const result = await this.persistInbound(pageId, `mock:${pageId}:${randomUUID()}`, { ...input, timestamp: Date.now() });
    if (!result) throw new NotFoundException('Không tìm thấy fanpage.');
    return { ...result, mode: 'mock' };
  }

  private async lock(tx: Tx, pageId: string, conversationId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pageId}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${conversationId}))`;
  }

  private emit(pageId: string, event: string, payload: unknown): void {
    void this.realtime.emitPage(pageId, event, payload).catch(() => this.logger.warn('Realtime invalidation postponed'));
  }

  private async assertActor(tx: Tx, userId: string, pageId: string): Promise<void> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, emailVerifiedAt: true } });
    if (!user?.emailVerifiedAt) throw new ForbiddenException('Phiên làm việc không còn hợp lệ.');
    if (user.role !== 'SUPER_ADMIN' && !await tx.pageMember.findUnique({ where: { userId_pageId: { userId, pageId } } })) {
      throw new ForbiddenException('Quyền truy cập fanpage đã bị thu hồi.');
    }
  }

  private inWindow(lastCustomerMessageAt: Date | null): boolean {
    return !!lastCustomerMessageAt && Date.now() - lastCustomerMessageAt.getTime() < 24 * 60 * 60 * 1000 && lastCustomerMessageAt.getTime() <= Date.now() + 60_000;
  }

  private async processInbound(id: string): Promise<void> {
    const event = await this.prisma.webhookEvent.findUniqueOrThrow({ where: { id } });
    if (event.status === 'DONE') return;
    await this.prisma.webhookEvent.update({ where: { id }, data: { status: 'PROCESSING', attempts: { increment: 1 }, error: null } });
    try {
      const inbound = event.payload as unknown as Inbound;
      const conversation = await this.prisma.conversation.upsert({
        where: { pageId_customerId: { pageId: event.pageId, customerId: inbound.customerId } },
        create: { pageId: event.pageId, customerId: inbound.customerId, customerName: inbound.customerName ?? 'Khách Messenger', lastCustomerMessageAt: new Date(inbound.timestamp) },
        update: {},
      });
      const delayed = await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, event.pageId, conversation.id);
        const current = await tx.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
        if (!current.lastCustomerMessageAt || current.lastCustomerMessageAt.getTime() < inbound.timestamp) {
          await tx.conversation.update({ where: { id: current.id }, data: { lastCustomerMessageAt: new Date(inbound.timestamp) } });
        }
        await tx.message.upsert({ where: { externalId: `${event.eventKey}:in` }, update: {}, create: { externalId: `${event.eventKey}:in`, conversationId: current.id, direction: 'INBOUND', sender: 'CUSTOMER', deliveryStatus: 'RECEIVED', text: inbound.text, createdAt: new Date(inbound.timestamp) } });
        return !!current.lastCustomerMessageAt && inbound.timestamp < current.lastCustomerMessageAt.getTime();
      });
      this.emit(event.pageId, 'conversation.updated', { conversationId: conversation.id });
      const prior = await this.prisma.message.findUnique({ where: { externalId: `${event.eventKey}:out` } });
      if (prior) {
        // A previous worker committed preparation but may have crashed before sending.
        // Its original state/version cannot be reconstructed safely: cancel rather than
        // reviving an AI reply after a human may have taken over.
        if (prior.deliveryStatus === 'PENDING') {
          await this.prisma.$transaction(async (tx) => {
            await this.lock(tx, event.pageId, conversation.id);
            await tx.message.updateMany({ where: { id: prior.id, deliveryStatus: 'PENDING' }, data: { deliveryStatus: 'FAILED' } });
            await tx.auditLog.create({ data: { pageId: event.pageId, action: 'PENDING_OUTBOUND_CANCELLED', metadata: { conversationId: conversation.id, messageId: prior.id, reason: 'WORKER_RECOVERY' } } });
          });
          await this.deliveryReview(conversation.id, event.pageId);
        } else if (prior.deliveryStatus === 'FAILED') await this.deliveryReview(conversation.id, event.pageId);
        await this.done(id); return;
      }
      if (delayed) {
        // Meta deliveries may arrive out of order. Keep history without answering an obsolete inquiry or bargaining twice.
        await this.prisma.auditLog.create({ data: { pageId: event.pageId, action: 'DELAYED_INBOUND_STORED', metadata: { conversationId: conversation.id, eventId: id } } });
        await this.done(id); return;
      }
      const page = await this.prisma.page.findUniqueOrThrow({ where: { id: event.pageId } });
      const snapshot = await this.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
      if (!page.aiEnabled || !snapshot.aiEnabled) { await this.done(id); return; }
      const products = await this.prisma.product.findMany({ where: { pageId: page.id, active: true }, take: 100 });
      const history = await this.prisma.message.findMany({ where: { conversationId: snapshot.id }, orderBy: { createdAt: 'desc' }, take: 10 });
      let intent: SalesIntent;
      let providerError = false;
      try {
        const safety = mockIntent(inbound.text, products, snapshot.interestedProductId);
        intent = safety.intent === 'HUMAN' || safety.intent === 'BUY' ? safety : await this.integrations.classify(inbound.text, products, snapshot.interestedProductId, history.reverse().map((message) => message.text), (page.settings as PageSettings).aiInstructions);
      } catch { providerError = true; intent = { intent: 'HUMAN', productId: snapshot.interestedProductId, offeredPrice: null, tone: 'POLITE' }; }
      const prepared = await this.prisma.$transaction(async (tx): Promise<Prepared | null> => {
        await this.lock(tx, page.id, snapshot.id);
        const currentPage = await tx.page.findUniqueOrThrow({ where: { id: page.id } });
        let current = await tx.conversation.findUniqueOrThrow({ where: { id: snapshot.id } });
        if (!currentPage.aiEnabled || !current.aiEnabled || current.version !== snapshot.version) return null;
        let reason: string | undefined;
        let reply: string;
        let notificationId: string | undefined;
        // Read catalog again under the page lock: a Sheets sync may have completed while OpenAI was running.
        const product = intent.productId ? await tx.product.findFirst({ where: { id: intent.productId, pageId: page.id, active: true } }) : null;
        const price = product ? resolvePrice(product) : { valid: false as const, reason: 'Chưa xác định sản phẩm khách quan tâm.' };
        const offeredPrice = extractOfferedPrice(inbound.text) ?? intent.offeredPrice;
        if (!this.inWindow(current.lastCustomerMessageAt)) reason = 'OUTSIDE_MESSAGING_WINDOW';
        else if (providerError) reason = 'AI_PROVIDER_UNAVAILABLE';
        else if (intent.intent === 'HUMAN') reason = 'CUSTOMER_REQUESTED_HUMAN';
        else if (intent.intent === 'BUY') reason = 'PURCHASE_CONFIRMATION';
        else if (!product) reason = 'PRODUCT_NOT_IDENTIFIED';
        else if (!price.valid) {
          reason = 'UNSAFE_PRICE_DATA';
          await tx.product.update({ where: { id: product.id }, data: { dataError: price.reason } });
        } else if (product.stock != null && product.stock <= 0) reason = 'OUT_OF_STOCK';
        else if (offeredPrice != null && offeredPrice < price.floor) reason = 'OFFER_BELOW_FLOOR';

        if (reason) {
          current = await tx.conversation.update({ where: { id: current.id }, data: { aiEnabled: false, status: reason === 'PURCHASE_CONFIRMATION' ? 'WAITING_CONFIRMATION' : 'NEEDS_HUMAN', handoffReason: reason, version: { increment: 1 }, ...(product ? { interestedProductId: product.id } : {}) } });
          await tx.auditLog.create({ data: { pageId: page.id, action: 'AI_HANDOFF', metadata: { conversationId: current.id, reason } } });
          const notification = await tx.notification.create({ data: { pageId: page.id, conversationId: current.id, reason } });
          notificationId = notification.id;
          reply = reason === 'PURCHASE_CONFIRMATION'
            ? 'Dạ, shop đã ghi nhận bạn muốn mua. Nhân viên sẽ xác nhận sản phẩm và thông tin cần thiết với bạn tại đây. Bạn vui lòng chờ shop xác nhận nhé; đơn hàng chưa được tạo.'
            : reason === 'OFFER_BELOW_FLOOR'
              ? 'Dạ, mức giá bạn đề nghị cần nhân viên kiểm tra thêm. Mình đã chuyển hội thoại cho shop hỗ trợ bạn nhé.'
              : 'Dạ, mình đã chuyển hội thoại cho nhân viên để kiểm tra và tư vấn chính xác hơn. Bạn chờ shop một chút nhé.';
        } else if (product && price.valid) {
          const latest = await tx.quote.findFirst({ where: { conversationId: current.id, productId: product.id }, orderBy: { createdAt: 'desc' } });
          const settings = currentPage.settings as PageSettings;
          const rules = settings.segmentRules?.[product.segment] ?? (product.segment === 'PREMIUM' ? [0.02, 0.02] : [0.05, 0.05]);
          const previous = latest && latest.floor === price.floor && latest.amount <= price.opening && latest.amount >= price.floor ? latest.amount : undefined;
          const bargaining = intent.intent === 'BARGAIN' && isBargainingRequest(inbound.text);
          const quote = negotiate(price, previous, previous != null ? latest!.step : 0, rules, bargaining);
          await tx.quote.create({ data: { conversationId: current.id, productId: product.id, amount: quote.amount, floor: price.floor, step: quote.step } });
          await tx.conversation.update({ where: { id: current.id }, data: { interestedProductId: product.id } });
          const amount = new Intl.NumberFormat('vi-VN').format(quote.amount);
          // Revalidate against the current locked catalog, not only the older OpenAI context.
          const advice = safeProductAdvice(intent.advice, product.description);
          const followUp = FOLLOW_UPS[intent.followUp ?? 'ASK_MORE'] ?? FOLLOW_UPS.ASK_MORE;
          reply = `${intent.tone === 'POLITE' ? 'Dạ thưa bạn' : 'Dạ bạn ơi'}, ${product.name}${product.dimensions ? ` (${product.dimensions})` : ''} có giá ${amount} ₫.${bargaining && previous != null && quote.amount < previous ? ' Shop hỗ trợ bạn mức này sau khi bạn đề nghị thương lượng.' : ''} ${advice ? advice + ' ' : ''}${followUp}`;
        } else return null;

        if (reason === 'OUTSIDE_MESSAGING_WINDOW') return { messageId: '', conversationId: current.id, pageId: page.id, version: current.version, customerId: current.customerId, text: '', handoff: true, notificationId };
        const outgoing = await tx.message.upsert({ where: { externalId: `${event.eventKey}:out` }, update: {}, create: { externalId: `${event.eventKey}:out`, conversationId: current.id, direction: 'OUTBOUND', sender: 'AI', deliveryStatus: 'PENDING', text: reply } });
        return { messageId: outgoing.id, conversationId: current.id, pageId: page.id, version: current.version, customerId: current.customerId, text: outgoing.text, handoff: !!reason, notificationId };
      }, { timeout: 15_000 });
      if (prepared?.notificationId) {
        try { await this.queue.add('notification', { id: prepared.notificationId }, { jobId: `note-${prepared.notificationId}` }); }
        catch { this.logger.warn(JSON.stringify({ event: 'notification_persisted_queue_pending', notificationId: prepared.notificationId })); }
      }
      if (prepared?.messageId) await this.dispatch(prepared, false);
      await this.done(id);
      this.emit(page.id, 'conversation.updated', { conversationId: conversation.id });
    } catch (error) {
      await this.prisma.webhookEvent.update({ where: { id }, data: { status: 'FAILED', error: error instanceof Error && error.message.includes('Nấc giảm') ? 'Cấu hình nấc giảm không hợp lệ.' : 'Xử lý thất bại; hàng đợi sẽ thử lại có giới hạn.' } });
      throw new Error('Inbound processing failed');
    }
  }

  private async done(id: string): Promise<void> { await this.prisma.webhookEvent.update({ where: { id }, data: { status: 'DONE', error: null } }); }

  /** Commit the attempt marker BEFORE contacting Meta. Ambiguous sends are never blindly retried. */
  private async dispatch(prepared: Prepared, human: boolean): Promise<void> {
    const claim = await this.prisma.message.updateMany({ where: { id: prepared.messageId, deliveryStatus: 'PENDING' }, data: { deliveryStatus: 'FAILED' } });
    if (!claim.count) return;
    let failed = false;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, prepared.pageId, prepared.conversationId);
      if (human && prepared.actorId) await this.assertActor(tx, prepared.actorId, prepared.pageId);
      const page = await tx.page.findUniqueOrThrow({ where: { id: prepared.pageId } });
      const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: prepared.conversationId } });
      if (conversation.version !== prepared.version || !this.inWindow(conversation.lastCustomerMessageAt) || (!human && (!page.aiEnabled || (!conversation.aiEnabled && !prepared.handoff)))) {
        await tx.auditLog.create({ data: { pageId: prepared.pageId, action: 'OUTBOUND_CANCELLED', metadata: { conversationId: prepared.conversationId, messageId: prepared.messageId, reason: 'STATE_CHANGED_OR_WINDOW_CLOSED' } } });
        return;
      }
      try {
        await this.integrations.sendMessenger(page, prepared.customerId, prepared.text);
        await tx.message.update({ where: { id: prepared.messageId }, data: { deliveryStatus: 'SENT', sentAt: new Date() } });
      } catch { failed = true; }
    }, { timeout: 25_000, maxWait: 10_000 });
    if (failed) await this.deliveryReview(prepared.conversationId, prepared.pageId);
  }

  private async deliveryReview(conversationId: string, pageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, pageId, conversationId);
      const current = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      if (current.handoffReason === 'DELIVERY_UNCERTAIN') return;
      await tx.conversation.update({ where: { id: conversationId }, data: { aiEnabled: false, status: current.status === 'TAKEN_OVER' || current.status === 'WAITING_CONFIRMATION' ? current.status : 'NEEDS_HUMAN', handoffReason: 'DELIVERY_UNCERTAIN', version: { increment: 1 } } });
      await tx.auditLog.create({ data: { pageId, action: 'DELIVERY_REVIEW_REQUIRED', metadata: { conversationId } } });
      await tx.notification.create({ data: { pageId, conversationId, reason: 'DELIVERY_UNCERTAIN' } });
    });
    this.emit(pageId, 'conversation.updated', { conversationId });
  }

  async sendHuman(pageId: string, conversationId: string, userId: string, text: string): Promise<unknown> {
    if (!text.trim() || text.length > 2000) throw new BadRequestException('Tin nhắn cần 1..2.000 ký tự.');
    const prepared = await this.prisma.$transaction(async (tx): Promise<Prepared> => {
      await this.lock(tx, pageId, conversationId);
      await this.assertActor(tx, userId, pageId);
      const conversation = await tx.conversation.findFirst({ where: { id: conversationId, pageId } });
      if (!conversation) throw new NotFoundException('Không tìm thấy hội thoại.');
      const current = await tx.conversation.update({ where: { id: conversationId }, data: { aiEnabled: false, status: 'TAKEN_OVER', version: { increment: 1 } } });
      await tx.auditLog.create({ data: { pageId, actorId: userId, action: 'HUMAN_REPLY', metadata: { conversationId } } });
      if (!this.inWindow(current.lastCustomerMessageAt)) return { messageId: '', conversationId, pageId, version: current.version, customerId: current.customerId, text: '', handoff: false };
      const message = await tx.message.create({ data: { conversationId, text: text.trim(), direction: 'OUTBOUND', sender: 'HUMAN', deliveryStatus: 'PENDING' } });
      return { messageId: message.id, conversationId, pageId, version: current.version, customerId: current.customerId, text: message.text, handoff: false, actorId: userId };
    });
    if (!prepared.messageId) {
      this.emit(pageId, 'conversation.updated', { conversationId });
      throw new BadRequestException('Đã tiếp quản, nhưng ngoài cửa sổ nhắn tin 24 giờ nên không gửi qua Send API.');
    }
    await this.dispatch(prepared, true);
    this.emit(pageId, 'conversation.updated', { conversationId });
    return this.prisma.message.findUnique({ where: { id: prepared.messageId } });
  }

  async syncPage(pageId: string): Promise<{ mode: string; count: number; syncedAt: Date }> {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Không tìm thấy fanpage.');
    try {
      const products = await this.integrations.readSheet(page);
      if (!products.length) throw new Error('Bảng không có sản phẩm; giữ cache để kiểm tra.');
      const syncedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pageId}))`;
        await tx.product.updateMany({ where: { pageId }, data: { active: false } });
        for (const product of products) {
          const price = resolvePrice(product);
          const data = { ...product, dataError: price.valid ? null : price.reason };
          await tx.product.upsert({ where: { pageId_sku: { pageId, sku: product.sku } }, create: { ...data, pageId }, update: data });
        }
        await tx.page.update({ where: { id: pageId }, data: { lastSyncedAt: syncedAt, syncError: null } });
        await tx.auditLog.create({ data: { pageId, action: 'SHEETS_SYNC', metadata: { count: products.length, mode: this.integrations.mock ? 'mock' : 'live' } } });
      }, { timeout: 30_000 });
      this.emit(pageId, 'products.updated', { count: products.length });
      return { mode: this.integrations.mock ? 'mock' : 'live', count: products.length, syncedAt };
    } catch {
      await this.prisma.page.update({ where: { id: pageId }, data: { syncError: 'Không đồng bộ được Google Sheets. Đang giữ cache trước đó; kiểm tra mapping/quyền/service account.' } });
      throw new BadRequestException('Đồng bộ thất bại; cache trước đó được giữ nguyên.');
    }
  }

  private async processNotification(id: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({ where: { id }, include: { page: true } });
    if (!notification || notification.status === 'SENT' || notification.attempts >= 4) return;
    await this.prisma.notification.update({ where: { id }, data: { attempts: { increment: 1 } } });
    try {
      const quote = notification.conversationId ? await this.prisma.quote.findFirst({ where: { conversationId: notification.conversationId }, include: { product: true }, orderBy: { createdAt: 'desc' } }) : null;
      const url = new URL('/inbox', process.env.APP_URL ?? 'http://localhost:5173');
      url.searchParams.set('pageId', notification.pageId);
      if (notification.conversationId) url.searchParams.set('conversationId', notification.conversationId);
      // Never include customer name, PSID, message text, phone, email or address.
      const text = [`Fanpage: ${notification.page.name}`, `Lý do: ${notification.reason}`, quote ? `Sản phẩm: ${quote.product.sku} — ${quote.product.name}` : 'Sản phẩm: cần xác nhận', quote ? `Giá gần nhất: ${new Intl.NumberFormat('vi-VN').format(quote.amount)} ₫` : 'Chưa báo giá', `Mở hội thoại: ${url.toString()}`].join('\n');
      await this.integrations.notifyTelegram(notification.page, text);
      await this.prisma.notification.update({ where: { id }, data: { status: 'SENT', error: this.integrations.mock ? 'MOCK: thông báo chỉ được mô phỏng, không gửi Telegram thật.' : null } });
      this.emit(notification.pageId, 'notification.updated', { notificationId: id });
    } catch {
      await this.prisma.notification.update({ where: { id }, data: { status: 'FAILED', error: 'Không gửi được Telegram; hội thoại vẫn trong dashboard. Thử lại tối đa 4 lần.' } });
      throw new Error('Telegram notification failed');
    }
  }
}
