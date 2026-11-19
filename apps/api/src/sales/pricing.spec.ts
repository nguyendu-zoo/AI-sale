import { negotiate, resolvePrice } from './pricing';

describe('deterministic VND pricing', () => {
  it('derives default opening and safe floor from cost', () => {
    expect(resolvePrice({ basePrice: 100_001 })).toEqual({ valid: true, opening: 170_001, floor: 150_002 });
  });
  it('uses max as opening and the larger of min/cost floor', () => {
    expect(resolvePrice({ basePrice: 100_000, minPrice: 120_000, maxPrice: 200_000 })).toEqual({ valid: true, opening: 200_000, floor: 150_000 });
    expect(resolvePrice({ minPrice: 180_000, maxPrice: 200_000 })).toEqual({ valid: true, opening: 200_000, floor: 180_000 });
  });
  it.each([{ maxPrice: 200_000 }, { minPrice: 200_000 }, {}, { basePrice: 0 }, { basePrice: -1 }, { basePrice: 1.5 }, { basePrice: NaN }, { minPrice: 3, maxPrice: 2 }, { basePrice: 100, maxPrice: 149 }])('rejects unsafe data %p', (input) => {
    expect(resolvePrice(input).valid).toBe(false);
  });
  it('never discounts before a request or on the first quote', () => {
    const bounds = { opening: 170_000, floor: 150_000 };
    expect(negotiate(bounds, 170_000, 0, [0.05], false)).toEqual({ amount: 170_000, step: 0 });
    expect(negotiate(bounds, undefined, 0, [0.05], true)).toEqual({ amount: 170_000, step: 0 });
  });
  it('reduces by configured steps and clamps at floor', () => {
    const bounds = { opening: 170_000, floor: 150_000 };
    expect(negotiate(bounds, 170_000, 0, [0.05, 0.2], true)).toEqual({ amount: 161_500, step: 1 });
    expect(negotiate(bounds, 161_500, 1, [0.05, 0.2], true)).toEqual({ amount: 150_000, step: 2 });
    expect(negotiate(bounds, 150_000, 2, [0.05, 0.2], true)).toEqual({ amount: 150_000, step: 2 });
  });
});
