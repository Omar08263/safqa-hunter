import { describe, expect, it } from 'vitest';
import { extract } from '../src/extract/jsonld.ts';
import { prioritise } from '../src/scheduler.ts';
import { matchKey } from '../src/safqa-core.ts';

describe('JSON-LD extractor', () => {
  it('reads schema.org Product with Offer (B.TECH shape)', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org/","@type":"Product","name":"Xiaomi Type C Mobile Cable 1 Meter White - SJV4108GL","sku":"1BSAASMOJV4108GLL001","brand":{"@type":"Brand","name":"Xiaomi"},"offers":{"@type":"Offer","priceCurrency":"EGP","price":331,"availability":"https://schema.org/InStock"}}</script>
      <script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[{"name":"Home"},{"name":"Mobiles"},{"name":"Cables"},{"name":"Xiaomi"}]}</script>`;
    const { item } = extract(html, 'https://btech.com/en/p/x');
    expect(item).toMatchObject({ title: expect.stringContaining('Xiaomi'), brand: 'Xiaomi', price: 331, currency: 'EGP', inStock: true, crumbs: ['Mobiles', 'Cables'] });
  });
  it('handles @graph + AggregateOffer + OutOfStock', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Galaxy A55 256GB","offers":{"@type":"AggregateOffer","lowPrice":"18,999","highPrice":"21000","priceCurrency":"EGP","availability":"OutOfStock"}}]}</script>`;
    const { item } = extract(html, 'u');
    expect(item?.price).toBe(18999); expect(item?.inStock).toBe(false);
  });
  it('collects price-like candidates when there is no structured price (self-healing input)', () => {
    const { item, candidates } = extract('<div class="product-price">EGP 1,250</div>', 'u');
    expect(item).toBeNull(); expect(candidates[0]?.text).toContain('1,250');
  });
});

describe('scheduler', () => {
  it('puts due watched products first, then new arrivals, then the stalest', () => {
    const now = Date.now();
    const out = prioritise(['a', 'b', 'c', 'd'], { c: { first: 0, last: now - 1000 }, d: { first: 0, last: now - 9e9 } }, [{ url: 'c', heat: 0, checked_at: new Date(now - 7 * 3600_000).toISOString(), watchers: 2 }], 4, now);
    expect(out[0]).toBe('c'); expect(out.slice(1, 3).sort()).toEqual(['a', 'b']); expect(out[3]).toBe('d');
  });
});

describe('matching', () => {
  it('uses the same keys as the Safqa Worker', () => {
    expect(matchKey({ title: 'Galaxy S24 Ultra 512GB', brand: null })).toBe(matchKey({ title: 'Samsung Galaxy S24 Ultra 512GB', brand: 'Samsung' }));
    expect(matchKey({ title: 'x', gtin: '6941812700000' })).toMatch(/^g:/);
  });
});
