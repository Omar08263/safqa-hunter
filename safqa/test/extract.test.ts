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
  it('never emits image "undefined" for a url-less ImageObject (IKEA shape): falls back to og:image, else null', () => {
    const withOg = `<meta property="og:image" content="https://www.ikea.com/eg/en/images/products/x.jpg"><script type="application/ld+json">{"@type":"Product","name":"BILLY bookcase","image":[{"@type":"ImageObject"}],"offers":{"@type":"Offer","priceCurrency":"EGP","price":2999}}</script>`;
    expect(extract(withOg, 'https://www.ikea.com/eg/en/p/billy-1/').item?.image).toBe('https://www.ikea.com/eg/en/images/products/x.jpg');
    const noOg = `<script type="application/ld+json">{"@type":"Product","name":"BILLY bookcase","image":{"@type":"ImageObject"},"offers":{"@type":"Offer","priceCurrency":"EGP","price":2999}}</script>`;
    expect(extract(noOg, 'https://www.ikea.com/eg/en/p/billy-1/').item?.image).toBeNull();
    const literal = `<script type="application/ld+json">{"@type":"Product","name":"BILLY bookcase","image":"undefined","offers":{"@type":"Offer","priceCurrency":"EGP","price":2999}}</script>`;
    expect(extract(literal, 'https://www.ikea.com/eg/en/p/billy-1/').item?.image).toBeNull();
  });
  it('keeps a valid image, picks the first valid candidate, and resolves relative image URLs', () => {
    const valid = `<script type="application/ld+json">{"@type":"Product","name":"X","image":"https://img.example/a.jpg","offers":{"@type":"Offer","priceCurrency":"EGP","price":10}}</script>`;
    expect(extract(valid, 'https://store.example/p/1').item?.image).toBe('https://img.example/a.jpg');
    const mixed = `<script type="application/ld+json">{"@type":"Product","name":"X","image":[{"@type":"ImageObject"},"https://img.example/b.jpg"],"offers":{"@type":"Offer","priceCurrency":"EGP","price":10}}</script>`;
    expect(extract(mixed, 'https://store.example/p/1').item?.image).toBe('https://img.example/b.jpg');
    const rel = `<script type="application/ld+json">{"@type":"Product","name":"X","image":"/img/c.jpg","offers":{"@type":"Offer","priceCurrency":"EGP","price":10}}</script>`;
    expect(extract(rel, 'https://store.example/p/1').item?.image).toBe('https://store.example/img/c.jpg');
    const obj = `<script type="application/ld+json">{"@type":"Product","name":"X","image":{"@type":"ImageObject","url":"https://img.example/d.jpg"},"offers":{"@type":"Offer","priceCurrency":"EGP","price":10}}</script>`;
    expect(extract(obj, 'https://store.example/p/1').item?.image).toBe('https://img.example/d.jpg');
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
