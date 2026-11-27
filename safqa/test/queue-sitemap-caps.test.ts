import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ROBOTS_FALLBACK_MAX_FILES, ROBOTS_FALLBACK_MAX_URLS } from '../src/config.ts';
import { limitSitemapList, openStoreQueue, storeQueueName } from '../src/hunt.ts';
import { streamSitemap } from '../src/adapters/sitemap.ts';

// politeFetch is mocked so sitemap streaming is tested without any network.
const fetchMock = vi.fn();
vi.mock('../src/http.ts', () => ({ politeFetch: (...args: unknown[]) => fetchMock(...args) }));

const urlset = (n: number, host = 'store.example') =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({ length: n }, (_, i) => `<url><loc>https://${host}/p/${i}</loc></url>`).join('')}</urlset>`;
const index = (files: string[]) =>
  `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map((f) => `<sitemap><loc>${f}</loc></sitemap>`).join('')}</sitemapindex>`;
const xmlResponse = (xml: string) => new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } });

describe('per-store RequestQueue isolation', () => {
  it('gives every store+crawl a distinct queue name', () => {
    const names = new Set([storeQueueName('ikea'), storeQueueName('ikea'), storeQueueName('btech')]);
    expect(names.size).toBe(3);
    for (const n of names) expect(n).toMatch(/^safqa-[a-z0-9-]+$/i);
  });
  it('two parallel store queues never exchange requests', async () => {
    const qa = await openStoreQueue('store-a');
    const qb = await openStoreQueue('store-b');
    try {
      expect(qa.id).not.toBe(qb.id);
      await qa.addRequests([{ url: 'https://a.example/p/1', uniqueKey: 'https://a.example/p/1' }, { url: 'https://a.example/p/2', uniqueKey: 'https://a.example/p/2' }]);
      await qb.addRequests([{ url: 'https://b.example/p/1', uniqueKey: 'https://b.example/p/1' }]);
      const ra1 = await qa.fetchNextRequest();
      const rb1 = await qb.fetchNextRequest();
      const ra2 = await qa.fetchNextRequest();
      expect(ra1?.url).toContain('a.example');
      expect(rb1?.url).toContain('b.example');
      expect(ra2?.url).toContain('a.example');
      expect(await qb.fetchNextRequest()).toBeNull(); // B had exactly one request; A's never leaked in
    } finally {
      await qa.drop().catch(() => {});
      await qb.drop().catch(() => {});
    }
  });
});

describe('robots-sitemap fallback caps', () => {
  beforeEach(() => { fetchMock.mockReset(); });
  it('defaults are 5 files / 20k URLs and limitSitemapList keeps only the first N', () => {
    expect(ROBOTS_FALLBACK_MAX_FILES).toBe(5);
    expect(ROBOTS_FALLBACK_MAX_URLS).toBe(20_000);
    const list = Array.from({ length: 30 }, (_, i) => `https://s.example/sm-${i}.xml`);
    expect(limitSitemapList(list, ROBOTS_FALLBACK_MAX_FILES)).toEqual(list.slice(0, 5));
    expect(limitSitemapList(list)).toHaveLength(30); // uncapped primary path unchanged
  });
  it('streamSitemap stops at maxEntries instead of downloading the whole file', async () => {
    fetchMock.mockResolvedValue(xmlResponse(urlset(100)));
    const out: string[] = [];
    for await (const e of streamSitemap('https://store.example/sitemap.xml', { maxEntries: 5 })) if ('loc' in e) out.push(e.loc);
    expect(out).toHaveLength(5);
    expect(out[4]).toContain('/p/4');
  });
  it('maxEntries budget is shared across nested sitemaps and maxNested bounds files fetched', async () => {
    const nested = ['https://store.example/n1.xml', 'https://store.example/n2.xml', 'https://store.example/n3.xml'];
    fetchMock.mockImplementation(async (url: string) => xmlResponse(url.endsWith('index.xml') ? index(nested) : urlset(10)));
    const out: string[] = [];
    for await (const e of streamSitemap('https://store.example/index.xml', { maxEntries: 7, maxNested: 2 })) if ('loc' in e) out.push(e.loc);
    expect(out).toHaveLength(7); // budget spent inside the first nested file
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2); // index + at most 1 nested before budget ends
  });
  it('maxNested bounds how many nested sitemap files are fetched', async () => {
    const nested = ['https://store.example/n1.xml', 'https://store.example/n2.xml', 'https://store.example/n3.xml'];
    fetchMock.mockImplementation(async (url: string) => xmlResponse(String(url).endsWith('index.xml') ? index(nested) : urlset(2)));
    const out: string[] = [];
    for await (const e of streamSitemap('https://store.example/index.xml', { maxEntries: 100, maxNested: 2 })) if ('loc' in e) out.push(e.loc);
    expect(out).toHaveLength(4); // 2 nested files x 2 entries; third nested file never fetched
    expect(fetchMock.mock.calls.length).toBe(3);
  });
  it('uncapped streaming still yields everything (primary sitemaps unchanged)', async () => {
    fetchMock.mockResolvedValue(xmlResponse(urlset(50)));
    const out: string[] = [];
    for await (const e of streamSitemap('https://store.example/sitemap.xml')) if ('loc' in e) out.push(e.loc);
    expect(out).toHaveLength(50);
  });
});
