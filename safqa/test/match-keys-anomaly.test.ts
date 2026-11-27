import { describe, expect, it } from 'vitest';
import { decideSame, extractAsin, fuzzyDecision, identityKey } from '../src/match-keys.ts';
import { countHistoryAnomalies, priceAnomaly } from '../src/anomaly.ts';
import { matchKey } from '../src/safqa-core.ts';

describe('hierarchical identity keys', () => {
  it('GTIN wins over everything', () => {
    const k = identityKey({ title: 'Galaxy A55', gtin: '8806095000000', mpn: 'SM-A556B' });
    expect(k.tier).toBe('gtin'); expect(k.key).toMatch(/^g:/); expect(k.confidence).toBe(1);
  });
  it('MPN next, then ASIN (field, URL, title)', () => {
    expect(identityKey({ title: 'Galaxy A55', brand: 'Samsung', mpn: 'SM-A556B' }).tier).toBe('mpn');
    expect(identityKey({ title: 'Kindle Paperwhite', asin: 'B09TMPS58R' }).key).toBe('a:B09TMPS58R');
    expect(extractAsin({ url: 'https://www.amazon.eg/dp/B09TMPS58R?tag=x' })).toBe('B09TMPS58R');
    expect(extractAsin({ title: 'Echo Dot B09B8V1LZ3' })).toBe('B09B8V1LZ3');
  });
  it('brand+title+size when no strong id; falls back to the Worker matchKey', () => {
    const k = identityKey({ title: 'Samsung Galaxy A55 256GB 8GB RAM', brand: 'Samsung' });
    expect(k.tier).toBe('brand-title-size'); expect(k.key).toContain('256');
    const bare = identityKey({ title: 'Generic cable' });
    expect(bare.key).toBe(matchKey({ title: 'Generic cable' }));
  });
  it('decideSame: strong-id mismatch is different, size conflict vetoes fuzzy', () => {
    expect(decideSame({ title: 'X', gtin: '8806095000000' }, { title: 'X', gtin: '8806095111111' }).same).toBe(false);
    const sizeClash = decideSame({ title: 'Galaxy A55 256GB' }, { title: 'Galaxy A55 128GB' });
    expect(sizeClash.same).toBe(false); expect(sizeClash.method).toBe('size-conflict');
    expect(decideSame({ title: 'Samsung Galaxy A55 256GB' }, { title: 'Galaxy A55 256GB Samsung' }).same).toBe(true);
  });
  it('fuzzball three zones with stored confidence', () => {
    expect(fuzzyDecision('Galaxy A55 256GB', 'Galaxy A55 256GB').zone).toBe('same');
    const grey = fuzzyDecision('Galaxy A55 256GB Blue', 'Galaxy A55 256GB Navy');
    expect(grey.zone).toBe('grey');
    expect(grey.score).toBeGreaterThanOrEqual(80); expect(grey.score).toBeLessThan(92);
    expect(fuzzyDecision('Galaxy A55', 'iPhone 15 Pro Max').zone).toBe('different');
    expect(fuzzyDecision('a', 'a').confidence).toBe(1);
  });
});

describe('MAD/IQR price anomaly', () => {
  const hist = [100, 102, 98, 101, 99, 100, 103, 97, 100, 101];
  it('flags a wild price, passes a normal one', () => {
    expect(priceAnomaly(hist, 500).anomalous).toBe(true);
    expect(priceAnomaly(hist, 500).method).toBe('mad');
    expect(priceAnomaly(hist, 101).anomalous).toBe(false);
    expect(priceAnomaly(hist, 10).anomalous).toBe(true);
  });
  it('needs enough history; flat history uses the 25% rule', () => {
    expect(priceAnomaly([100, 100], 500).anomalous).toBe(false);
    expect(priceAnomaly([100, 100, 100, 100, 100, 100], 130).anomalous).toBe(true);
    expect(priceAnomaly([100, 100, 100, 100, 100, 100], 110).anomalous).toBe(false);
  });
  it('rollup counts flagged observations per product history', () => {
    const { count, flagged } = countHistoryAnomalies(
      [{ key: 'a', price: 100 }, { key: 'a', price: 999 }, { key: 'b', price: 50 }],
      { a: hist, b: [50, 51, 49, 50, 52, 50] },
    );
    expect(count).toBe(1); expect(flagged[0]?.key).toBe('a');
  });
});
