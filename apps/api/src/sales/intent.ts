export type IntentName = 'PRODUCT' | 'BARGAIN' | 'HUMAN' | 'BUY' | 'OTHER';
export interface SalesIntent {
  intent: IntentName;
  productId: string | null;
  offeredPrice: number | null;
  tone: 'FRIENDLY' | 'POLITE';
  advice?: string;
  followUp?: 'ASK_MORE' | 'ASK_USAGE' | 'ASK_STYLE';
}
export interface IntentProduct { id: string; sku: string; name: string }

export const normalizeText = (text: string): string =>
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** A model label alone cannot authorize a discount step. */
export function isBargainingRequest(text: string): boolean {
  const normalized = normalizeText(text);
  if (/\b(?:khong|ko|chua|dung)\s+(?:(?:can|muon|yeu cau)\s+)?(?:giam|bot|mac ca|thuong luong)\b/.test(normalized)) return false;
  if (/\b(?:giam|bot|re hon|mac ca|thuong luong|gia tot|gia mem|uu dai|discount|cheaper)\b/.test(normalized)) return true;
  return /\b(?:duoc khong|duoc ko|duoc k)\b/.test(normalized) && extractOfferedPrice(normalized) !== null;
}

export function extractOfferedPrice(text: string): number | null {
  const normalized = normalizeText(text);
  const amount = normalized.match(/\b(\d+(?:[.,]\d+)*)\s*(trieu|tr|nghin|ngan|k|dong|d|vnd)\b/);
  const bare = !amount && /\b(?:duoc khong|duoc ko|de nghi|giam|bot|tra)\b/.test(normalized)
    ? normalized.match(/\b(\d{4,}|\d{1,3}(?:[.,]\d{3})+)\b/)
    : null;
  const value = amount?.[1] ?? bare?.[1];
  if (!value) return null;
  const unit = amount?.[2] ?? 'd';
  const multiplier = /trieu|tr/.test(unit) ? 1_000_000 : /nghin|ngan|k/.test(unit) ? 1_000 : 1;
  const numeric = multiplier === 1 && /^\d{1,3}(?:[.,]\d{3})+$/.test(value)
    ? Number(value.replace(/[.,]/g, ''))
    : /^\d+(?:[.,]\d+)?$/.test(value) ? Number(value.replace(',', '.')) : NaN;
  const result = Math.round(numeric * multiplier);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

/** Mock adapter only; live mode uses OpenAI structured classification. */
export function mockIntent(text: string, products: IntentProduct[], currentProductId?: string | null): SalesIntent {
  const normalized = normalizeText(text);
  let intent: IntentName = 'PRODUCT';
  if (/nhan vien|nguoi that|tu van vien|gap shop|tep dinh kem/.test(normalized)) intent = 'HUMAN';
  else if (/chot|dong y mua|dat mua|lay (?:cho|giup)|mua luon|xac nhan mua/.test(normalized)) intent = 'BUY';
  else if (isBargainingRequest(text)) intent = 'BARGAIN';
  const exact = products.find((product) => normalized.includes(normalizeText(product.sku)) || normalized.includes(normalizeText(product.name)));
  const terms = products.map((product) => ({
    product,
    score: normalizeText(product.name).split(/\s+/).filter((word) => word.length > 2 && normalized.includes(word)).length,
  })).sort((a, b) => b.score - a.score);
  const best = terms[0];
  const match = exact ?? (best && best.score >= 2 ? best.product : undefined);
  const offeredPrice = extractOfferedPrice(text);
  return { intent, productId: match?.id ?? currentProductId ?? null, offeredPrice, tone: 'FRIENDLY' };
}
