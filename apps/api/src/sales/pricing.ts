export interface PriceInput {
  basePrice?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
}

export type PriceResult =
  | { valid: true; opening: number; floor: number }
  | { valid: false; reason: string };

/** VND uses whole đồng. The floor rounds UP; an offer rounds DOWN. */
export function resolvePrice(product: PriceInput): PriceResult {
  for (const value of [product.basePrice, product.minPrice, product.maxPrice]) {
    if (value != null && (!Number.isSafeInteger(value) || value <= 0)) {
      return { valid: false, reason: 'Giá phải là số nguyên VND lớn hơn 0.' };
    }
  }
  const { basePrice, minPrice, maxPrice } = product;
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    return { valid: false, reason: 'Giá min lớn hơn giá max.' };
  }
  const floor = Math.max(minPrice ?? 0, basePrice ? Math.ceil(basePrice * 3 / 2) : 0);
  const opening = maxPrice ?? (basePrice ? Math.floor(basePrice * 17 / 10) : 0);
  if (!floor || !opening) {
    return { valid: false, reason: 'Thiếu dữ liệu để xác định giá chào và sàn an toàn.' };
  }
  if (floor > opening) return { valid: false, reason: 'Giá sàn hiệu lực lớn hơn giá chào.' };
  if (opening > 2_147_483_647 || floor > 2_147_483_647) return { valid: false, reason: 'Giá vượt giới hạn số nguyên VND được hỗ trợ.' };
  return { valid: true, opening, floor };
}

export function negotiate(
  price: { opening: number; floor: number },
  previous: number | undefined,
  completedSteps: number,
  rules: number[],
  bargaining: boolean,
): { amount: number; step: number } {
  const current = previous ?? price.opening;
  if (!bargaining || previous == null || completedSteps >= rules.length) {
    return { amount: current, step: completedSteps };
  }
  const fraction = rules[completedSteps];
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new Error('Nấc giảm phải nằm trong khoảng 0..1.');
  }
  return {
    amount: Math.max(price.floor, Math.floor(current - price.opening * fraction)),
    step: completedSteps + 1,
  };
}
