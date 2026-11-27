import { describe, expect, it } from 'vitest';
import { classifyTier, prioritise } from '../src/scheduler.ts';
import { readabilityProposal } from '../src/extract/readability.ts';
import { parseSitemapHtmlparser2 } from '../src/adapters/sitemap-htmlparser.ts';
import type { UrlState } from '../src/state.ts';

const DAY = 86400_000;
const now = Date.now();

describe('A/B/C/D change-velocity tiers', () => {
  it('classifies by measured changes and failures', () => {
    expect(classifyTier({ first: now - 30 * DAY, changes: 5 }, now)).toBe('A');
    expect(classifyTier({ first: now - 2 * DAY, changes: 2 }, now)).toBe('A'); // >=1/day
    expect(classifyTier({ first: now - 30 * DAY, changes: 1 }, now)).toBe('B');
    expect(classifyTier({ first: now - 30 * DAY, changes: 0 }, now)).toBe('C');
    expect(classifyTier({ first: now - 30 * DAY, changes: 9, fails: 3 }, now)).toBe('D'); // failures win
  });
  it('prioritise orders known URLs A before C before D (interface unchanged)', () => {
    const seen: Record<string, UrlState> = {
      a: { first: now - 30 * DAY, last: now - DAY, changes: 4 },
      c: { first: now - 30 * DAY, last: now - DAY, changes: 0 },
      d: { first: now - 30 * DAY, last: now - DAY, changes: 0, fails: 5 },
    };
    const out = prioritise(['a', 'c', 'd'], seen, [], 3, now);
    expect(out).toEqual(['a', 'c', 'd']);
  });
});

describe('Readability fifth layer (proposal-only)', () => {
  const html = `<html><head><title>Galaxy A55</title></head><body><nav>menu links</nav><article>
    <h1>Samsung Galaxy A55 256GB</h1>
    <p>${'مواصفات الهاتف كاملة مع شاشة سوبر أموليد وكاميرا احترافية وبطارية قوية تدوم طوال اليوم. '.repeat(6)}</p>
    <p>السعر الآن 18,999 جنيه فقط لفترة محدودة، أو ١٨٬٩٩٩ ج.م مع الشحن المجاني داخل القاهرة والجيزة.</p>
    <p>${'تفاصيل إضافية عن الضمان وخدمة ما بعد البيع وسياسة الاستبدال والاسترجاع خلال ثلاثين يوما. '.repeat(6)}</p>
    </article><footer>copyright</footer></body></html>`;
  it('proposes price candidates from main text, never an item', () => {
    const p = readabilityProposal(html, 'https://store.example/p/1');
    expect(p).not.toBeNull();
    expect(p!.candidates.length).toBeGreaterThanOrEqual(1);
    expect(p!.candidates[0]?.cls).toBe('readability');
    expect(p!.candidates.some((c) => c.text.includes('18,999') || c.text.includes('١٨'))).toBe(true);
  });
  it('returns null on garbage instead of throwing', () => {
    expect(readabilityProposal('', 'u')).toBeNull();
    expect(readabilityProposal('<html></html>', 'u')).toBeNull();
  });
});

describe('htmlparser2 sitemap parsing vs regex-chunk approach', () => {
  const makeSitemap = (n: number) => {
    let s = '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">';
    for (let i = 0; i < n; i++) s += `<url><loc>https://store.example/p/${i}?a=1&amp;b=2</loc><lastmod>2026-11-0${(i % 9) + 1}</lastmod><xhtml:link rel="alternate" hreflang="ar" href="https://store.example/ar/p/${i}"/></url>`;
    return s + '</urlset>';
  };
  it('parses loc/lastmod/alternates with entities decoded', () => {
    const out = parseSitemapHtmlparser2(makeSitemap(3));
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ loc: 'https://store.example/p/0?a=1&b=2', lastmod: '2026-11-01', alternates: { ar: 'https://store.example/ar/p/0' } });
  });
  it('handles a 20k-entry sitemap correctly (bench recorded in test output)', () => {
    const xml = makeSitemap(20_000);
    const t0 = performance.now();
    const out = parseSitemapHtmlparser2(xml);
    const ms = performance.now() - t0;
    console.log(`htmlparser2: 20000 entries in ${ms.toFixed(0)}ms (${(xml.length / 1e6).toFixed(1)}MB)`);
    expect(out).toHaveLength(20_000);
    expect(out[19_999]?.loc).toContain('/p/19999');
    expect(ms).toBeLessThan(10_000);
  });
});
