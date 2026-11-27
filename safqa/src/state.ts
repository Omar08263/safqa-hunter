// Run-to-run memory (persisted by actions/cache in CI): which URLs we have seen, when we last fetched them,
// a hash of what we last sent (unchanged pages are not re-sent), sitemap ETags, and per-store refusals.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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
export function saveState(s: State) { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(s)); }
export const stateExists = () => existsSync(FILE);
