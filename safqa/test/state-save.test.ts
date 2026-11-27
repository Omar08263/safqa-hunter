import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// SAFQA_STATE must be set before importing state.ts (module reads it at load time).
const dir = mkdtempSync(join(tmpdir(), 'safqa-state-'));
process.env.SAFQA_STATE = join(dir, 'state.json');
const { loadState, saveState, SITEMAP_CACHE_MAX } = await import('../src/state.ts');

describe('streamed state save', () => {
  it('round-trips and truncates oversized sitemap caches', async () => {
    const big = Array.from({ length: SITEMAP_CACHE_MAX + 5000 }, (_, i) => ({ loc: `https://x.example/p/${i}`, alternates: {} }));
    await saveState({
      urls: { btech: { 'https://btech.com/p/1': { first: 1, hash: 'abc', sentAt: 2, changes: 3, scrapeStatus: 'ok' } } },
      etags: { 'https://x.example/sitemap.xml': 'W/"1"' },
      refusedUntil: {}, refusals: {},
      sitemapCache: { 'https://x.example/sitemap.xml': { etag: 'W/"1"', entries: big } },
    });
    const raw = readFileSync(process.env.SAFQA_STATE!, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.sitemapCache['https://x.example/sitemap.xml'].entries).toHaveLength(SITEMAP_CACHE_MAX);
    const loaded = loadState();
    expect(loaded.urls.btech?.['https://btech.com/p/1']).toMatchObject({ hash: 'abc', sentAt: 2, changes: 3, scrapeStatus: 'ok' });
    expect(loaded.etags['https://x.example/sitemap.xml']).toBe('W/"1"');
  });
});
