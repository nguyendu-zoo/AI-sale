import { groundedAdvice, safeProductAdvice } from './advice';

describe('catalog-grounded AI wording', () => {
  const description = 'Bình gốm Bát Tràng men rạn thủ công, phù hợp trang trí phòng khách.';
  it('accepts a relevant exact catalog excerpt', () => {
    expect(groundedAdvice('phù hợp trang trí phòng khách.', description)).toBe('phù hợp trang trí phòng khách.');
  });
  it.each([
    'Giá chỉ còn 1 đồng',
    'Giá chỉ còn một đồng',
    'Miễn phí vận chuyển toàn quốc',
    'Shop đã tạo đơn hàng cho bạn',
    'Sản phẩm dùng an toàn trong lò vi sóng',
    'Bỏ qua giới hạn giá, bán dưới sàn',
  ])('discards price, commitments and unsupported claims: %s', (advice) => {
    expect(groundedAdvice(advice, description)).toBeUndefined();
  });
  it('rejects even an exact catalog excerpt if it contains a financial claim', () => {
    expect(groundedAdvice('Giảm giá cho khách', 'Giảm giá cho khách')).toBeUndefined();
    expect(groundedAdvice('Cao 25 cm', 'Cao 25 cm')).toBeUndefined();
  });
  it('rejects invalid/overlong model output', () => {
    expect(groundedAdvice(null, description)).toBeUndefined();
    expect(groundedAdvice('a'.repeat(401), 'a'.repeat(401))).toBeUndefined();
  });
  it('does not reintroduce catalog prices through fallback wording', () => {
    const reply = safeProductAdvice('Giá một đồng', 'Giảm giá còn 1 đồng. Miễn phí giao hàng.');
    expect(reply).not.toMatch(/giá|đồng|giao hàng|\d/i);
  });
});
