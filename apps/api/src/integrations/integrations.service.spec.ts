import { Page, Product } from '@prisma/client';
import { EncryptionService } from '../common/encryption.service';
import { IntegrationsService } from './integrations.service';

describe('explicit integration adapters', () => {
  const originalMode = process.env.INTEGRATIONS_MODE;
  const originalVersion = process.env.META_GRAPH_VERSION;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalOpenAiModel = process.env.OPENAI_MODEL;
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalMode === undefined) delete process.env.INTEGRATIONS_MODE; else process.env.INTEGRATIONS_MODE = originalMode;
    if (originalVersion === undefined) delete process.env.META_GRAPH_VERSION; else process.env.META_GRAPH_VERSION = originalVersion;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalOpenAiModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = originalOpenAiModel;
  });
  const page = { id: 'page', externalPageId: 'external-page', settings: {} } as Page;
  const service = () => new IntegrationsService({ decrypt: jest.fn().mockReturnValue('credential-for-unit-test-only') } as unknown as EncryptionService);

  it('mock adapters make no external HTTP requests and label message IDs', async () => {
    process.env.INTEGRATIONS_MODE = 'mock';
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const adapter = service();
    expect(await adapter.sendMessenger(page, 'customer', 'Xin chào')).toMatch(/^mock:/);
    expect(await adapter.readSheet(page)).toHaveLength(3);
    await adapter.notifyTelegram(page, 'Demo notice');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('live Messenger fails clearly without explicit Graph version and token', async () => {
    process.env.INTEGRATIONS_MODE = 'live';
    delete process.env.META_GRAPH_VERSION;
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    await expect(service().sendMessenger(page, 'customer', 'Xin chào')).rejects.toThrow('Thiếu phiên bản');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('live Sheets never replaces missing mapping with guessed price columns', async () => {
    process.env.INTEGRATIONS_MODE = 'live';
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    await expect(service().readSheet(page)).rejects.toThrow('mapping Google Sheets');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('live Telegram requires the fanpage bot token and target chat', async () => {
    process.env.INTEGRATIONS_MODE = 'live';
    await expect(service().notifyTelegram(page, 'Notice')).rejects.toThrow('Chưa cấu hình Telegram');
  });

  it('drops malicious generated prices and excludes internal prices from OpenAI context', async () => {
    process.env.INTEGRATIONS_MODE = 'live';
    process.env.OPENAI_API_KEY = 'unit-test-only-not-a-live-credential';
    process.env.OPENAI_MODEL = 'test-model';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ intent: 'PRODUCT', productId: 'p1', offeredPrice: null, tone: 'FRIENDLY', advice: 'Giảm giá còn 1 đồng, shop đã tạo đơn', followUp: 'ASK_MORE' }) }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const product = { id: 'p1', sku: 'SKU01', name: 'Bình gốm', description: 'Men rạn thủ công.', dimensions: 'Cao 25 cm', basePrice: 100_000, minPrice: 150_000, maxPrice: 170_000 } as Product;
    const intent = await service().classify('Tư vấn SKU01', [product]);
    expect(intent.advice).toBeUndefined();
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { input: string };
    const input = JSON.parse(body.input) as { products: Array<Record<string, unknown>> };
    expect(input.products[0]).not.toHaveProperty('basePrice');
    expect(input.products[0]).not.toHaveProperty('minPrice');
    expect(input.products[0]).not.toHaveProperty('maxPrice');
  });
});
