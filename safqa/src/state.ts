// Run-to-run memory (persisted by actions/cache in CI): which URLs we have seen, when we last fetched them,
// a hash of what we last sent (unchanged pages are not re-sent), sitemap ETags, and per-store refusals.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface UrlState { first: number; last?: number; hash?: string; fails?: number; etag?: string; lastModified?: string }
export interface SitemapCacheEntry { etag?: string; entries: { loc: string; lastmod?: string; alternates: Record<string, string> }[] }
export interface State { urls: Record<string, Record<string, UrlState>>; etags: Record<string, string>; refusedUntil: Record<string, number>; sitemapCache: Record<string, SitemapCacheEntry> }
const FILE = process.env.SAFQA_STATE ?? 'state/state.json';
export function loadState(): State {
  try { const s = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<State>; return { urls: s.urls ?? {}, etags: s.etags ?? {}, refusedUntil: s.refusedUntil ?? {}, sitemapCache: s.sitemapCache ?? {} }; }
  catch { return { urls: {}, etags: {}, refusedUntil: {}, sitemapCache: {} }; }
}
export function saveState(s: State) { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(s)); }
export const stateExists = () => existsSync(FILE);
