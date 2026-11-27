// Run-to-run memory (persisted by actions/cache in CI): which URLs we have seen, when we last fetched them,
// a hash of what we last sent (unchanged pages are not re-sent), sitemap ETags, and per-store refusals.
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Max sitemap entries cached per sitemap URL. A 2.8M-entry sitemap (samsung, 2026-11-27) blew
 *  past V8's max string length in JSON.stringify and crashed saveState — cap the cache hard. */
export const SITEMAP_CACHE_MAX = 100_000;

export interface UrlState {
  first: number; last?: number; hash?: string; fails?: number; etag?: string; lastModified?: string;
  /** When this URL's item was last SENT to the API (drives the unchanged-refresh window). */
  sentAt?: number;
  /** How many times the sent fingerprint actually changed (drives A/B/C/D scheduling tiers). */
  changes?: number;
  /** Outcome of the last scrape attempt, kept separate from `hash` so a failure never
   *  overwrites the last known-good fingerprint. */
  scrapeStatus?: 'ok' | 'failed' | 'unchanged';
}
export interface SitemapCacheEntry { etag?: string; entries: { loc: string; lastmod?: string; alternates: Record<string, string> }[] }
export interface State { urls: Record<string, Record<string, UrlState>>; etags: Record<string, string>; refusedUntil: Record<string, number>; refusals: Record<string, number>; sitemapCache: Record<string, SitemapCacheEntry> }
const FILE = process.env.SAFQA_STATE ?? 'state/state.json';
export function loadState(): State {
  try {
    const s = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<State>;
    const refusedUntil = s.refusedUntil ?? {}; const refusals = s.refusals ?? {};
    // Legacy migration: refusals recorded before graduated cooldowns carried a flat 24 h.
    // Clamp any legacy entry (no refusal count) to at most 1 h from now so the store is re-tested soon;
    // if it refuses again, the graduated ladder applies from there.
    const cap = Date.now() + 3600_000;
    for (const k of Object.keys(refusedUntil)) if (!(k in refusals) && refusedUntil[k]! > cap) refusedUntil[k] = cap;
    return { urls: s.urls ?? {}, etags: s.etags ?? {}, refusedUntil, refusals, sitemapCache: s.sitemapCache ?? {} };
  }
  catch { return { urls: {}, etags: {}, refusedUntil: {}, refusals: {}, sitemapCache: {} }; }
}
/** Streamed save: never builds one giant string (RangeError on huge sitemap caches).
 *  Oversized sitemap caches are truncated to SITEMAP_CACHE_MAX entries on the way out. */
export async function saveState(s: State): Promise<void> {
  mkdirSync(dirname(FILE), { recursive: true });
  const ws = createWriteStream(FILE);
  const done = new Promise<void>((resolve, reject) => { ws.on('finish', resolve); ws.on('error', reject); });
  const write = (chunk: string) => { ws.write(chunk); };
  write('{"urls":');
  write(JSON.stringify(s.urls));
  write(',"etags":');
  write(JSON.stringify(s.etags));
  write(',"refusedUntil":');
  write(JSON.stringify(s.refusedUntil));
  write(',"refusals":');
  write(JSON.stringify(s.refusals));
  write(',"sitemapCache":{');
  let first = true;
  for (const [k, v] of Object.entries(s.sitemapCache)) {
    if (!first) write(',');
    first = false;
    const entries = v.entries.length > SITEMAP_CACHE_MAX ? v.entries.slice(0, SITEMAP_CACHE_MAX) : v.entries;
    write(`${JSON.stringify(k)}:{"etag":${JSON.stringify(v.etag ?? null)},"entries":${JSON.stringify(entries)}}`);
  }
  write('}}');
  ws.end();
  await done;
}
export const stateExists = () => existsSync(FILE);
