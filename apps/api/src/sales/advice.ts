import { normalizeText } from './intent';

/** Accept extractive catalog advice only. The model never supplies financial or fulfilment claims. */
export function groundedAdvice(advice: unknown, description: string): string | undefined {
  if (typeof advice !== 'string' || !advice.trim() || advice.length > 400) return undefined;
  if (/[\p{N}\p{Sc}]/u.test(advice)) return undefined;
  const normalized = normalizeText(advice);
  if (/\b(gia|vnd|usd|giam|chiet khau|uu dai|mien phi|van chuyen|giao hang|thanh toan|dat coc|dat hang|don hang|bao hanh|cam ket)\b/.test(normalized)) return undefined;
  const canonical = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!canonical(description).includes(canonical(advice))) return undefined;
  return advice.trim();
}

export function safeProductAdvice(advice: unknown, description: string): string {
  return groundedAdvice(advice, description)
    ?? groundedAdvice(description.slice(0, 400), description)
    ?? 'Bạn có thể xem thêm thông tin sản phẩm cùng nhân viên của shop.';
}

export const FOLLOW_UPS: Record<string, string> = {
  ASK_MORE: 'Bạn muốn shop tư vấn thêm về sản phẩm này không ạ?',
  ASK_USAGE: 'Bạn dự định dùng sản phẩm để trang trí hay làm quà ạ?',
  ASK_STYLE: 'Bạn thích phong cách nào để shop tư vấn thêm cho phù hợp ạ?',
};
