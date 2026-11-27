import { describe, expect, it } from 'vitest';
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

describe('extractor pageTitle fallback (heal input when item is null)', () => {
  it('returns og:title even with no structured product', () => {
    const html = '<meta property="og:title" content="Widget X"><div class="price">EGP 999</div>';
    const { item, candidates, pageTitle } = extract(html, 'u');
    expect(item).toBeNull();
    expect(pageTitle).toBe('Widget X');
    expect(candidates.length).toBeGreaterThan(0);
  });
});
