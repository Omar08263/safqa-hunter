import { describe, expect, it } from 'vitest';
import { cooldownMs } from '../src/config.ts';
import { extract } from '../src/extract/jsonld.ts';
import { parseRetryAfter } from '../src/http.ts';
import { plausibleEgp } from '../src/safqa-core.ts';
import { prioritise } from '../src/scheduler.ts';

describe('Retry-After parsing', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '120' }))).toBe(120_000);
  });
  it('reads an HTTP-date relative to now', () => {
    const now = Date.parse('2026-11-27T12:00:00Z');
    expect(parseRetryAfter(new Headers({ 'retry-after': 'Fri, 27 Nov 2026 12:30:00 GMT' }), now)).toBe(30 * 60_000);
  });
  it('returns null when absent or invalid', () => {
    expect(parseRetryAfter(new Headers())).toBeNull();
    expect(parseRetryAfter(new Headers({ 'retry-after': 'soon' }))).toBeNull();
  });
});

describe('graduated refusal cooldown', () => {
  it('escalates 1h → 3h → 6h → 12h → 24h and caps there', () => {
    const H = 3600_000;
    expect(cooldownMs(1)).toBe(1 * H);
    expect(cooldownMs(2)).toBe(3 * H);
    expect(cooldownMs(3)).toBe(6 * H);
    expect(cooldownMs(4)).toBe(12 * H);
    expect(cooldownMs(5)).toBe(24 * H);
    expect(cooldownMs(99)).toBe(24 * H);
  });
});

describe('statistical price anomalies', () => {
  it('flags >40% deviations from the group median, ignores small groups', async () => {
    const { countAnomalies } = await import('../src/safqa-core.ts');
    const priced = [
      { key: 'a', price: 100 }, { key: 'a', price: 105 }, { key: 'a', price: 98 }, { key: 'a', price: 300 }, // 300 deviates
      { key: 'b', price: 50 }, { key: 'b', price: 500 }, // group of 2: ignored
      { key: 'c', price: 1000 }, { key: 'c', price: 1010 }, { key: 'c', price: 990 }, // clean
    ];
    expect(countAnomalies(priced)).toBe(1);
    expect(countAnomalies([])).toBe(0);
  });
});

describe('price sanity gate', () => {
  it('rejects NaN, zero, placeholders and absurd values', () => {
    expect(plausibleEgp(NaN)).toBe(false);
    expect(plausibleEgp(0)).toBe(false);
    expect(plausibleEgp(1)).toBe(false);
    expect(plausibleEgp(2_000_000)).toBe(false);
    expect(plausibleEgp(331)).toBe(true);
    expect(plausibleEgp(18_999)).toBe(true);
  });
});

describe('scheduler lastmod awareness', () => {
  it('fetches pages changed since our last fetch before merely stale ones', () => {
    const now = Date.parse('2026-11-27T12:00:00Z');
    const seen = {
      stale: { first: 0, last: now - 10 * 3600_000 },
      changed: { first: 0, last: now - 3600_000 },
    };
    const lastmods = { changed: new Date(now - 60_000).toISOString(), stale: new Date(now - 20 * 3600_000).toISOString() };
    const out = prioritise(['stale', 'changed'], seen, [], 2, now, lastmods);
    expect(out[0]).toBe('changed');
  });
  it('keeps old behaviour when no lastmods are given', () => {
    const now = Date.now();
    const out = prioritise(['a', 'b'], { a: { first: 0, last: now - 1000 }, b: { first: 0, last: now - 9e9 } }, [], 2, now);
    expect(out[0]).toBe('b');
  });
});

describe('microdata extraction layer', () => {
  it('extracts Product from itemscope/itemprop when JSON-LD is absent', () => {
    const html = `<html><head><title>x</title></head><body>
      <div itemscope itemtype="https://schema.org/Product">
        <h1 itemprop="name">Test Phone</h1>
        <span itemprop="brand">Acme</span>
        <meta itemprop="priceCurrency" content="EGP">
        <span itemprop="price" content="12999">12,999 EGP</span>
        <link itemprop="availability" href="https://schema.org/InStock">
        <img itemprop="image" src="https://example.com/p.jpg">
      </div></body></html>`;
    const { item } = extract(html, 'https://example.com/p');
    expect(item?.title).toBe('Test Phone');
    expect(item?.price).toBe(12999);
    expect(item?.brand).toBe('Acme');
    expect(item?.inStock).toBe(true);
  });
  it('JSON-LD still wins over microdata when both exist', () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Product","name":"LD Phone","offers":{"price":5000,"priceCurrency":"EGP"}}</script></head>
      <body><div itemscope itemtype="https://schema.org/Product"><span itemprop="name">MD Phone</span><span itemprop="price" content="9999"></span></div></body></html>`;
    expect(extract(html, 'https://example.com/p').item?.title).toBe('LD Phone');
  });
});

describe('extractor pageTitle fallback (heal input when item is null)', () => {
  it('returns og:title even with no structured product', () => {
    const html = '<meta property="og:title" content="Widget X"><div class="price">EGP 999</div>';
    const { item, candidates, pageTitle } = extract(html, 'u');
    expect(item).toBeNull();
    expect(pageTitle).toBe('Widget X');
    expect(candidates.length).toBeGreaterThan(0);
  });
});
