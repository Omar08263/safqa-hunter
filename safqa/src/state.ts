// Run-to-run memory (persisted by actions/cache in CI): which URLs we have seen, when we last fetched them,
// a hash of what we last sent (unchanged pages are not re-sent), sitemap ETags, and per-store refusals.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface UrlState { first: number; last?: number; hash?: string; fails?: number }
export interface State { urls: Record<string, Record<string, UrlState>>; etags: Record<string, string>; refusedUntil: Record<string, number> }
const FILE = process.env.SAFQA_STATE ?? 'state/state.json';
export function loadState(): State {
  try { return JSON.parse(readFileSync(FILE, 'utf8')) as State; } catch { return { urls: {}, etags: {}, refusedUntil: {} }; }
}
export function saveState(s: State) { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(s)); }
export const stateExists = () => existsSync(FILE);
