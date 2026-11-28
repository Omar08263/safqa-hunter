// The only network path the hunter uses: plain fetch with an honest SafqaBot User-Agent.
// Crawlee's default got-scraping client generates browser-like fingerprint headers; we deliberately do not use it.
import { MIN_DELAY_MS, UA } from './config.ts';

// NOTE (2026-11-28, measured): an explicit undici Agent dispatcher was tried for keep-alive
// tuning and REJECTED with evidence — the standalone undici Agent ignores NODE_USE_ENV_PROXY,
// so in proxied environments every fetch dies with an SSL "wrong version number" error, while
// Node's built-in dispatcher honours the env proxy and already pools keep-alive connections
// (default keepAliveTimeout 4s > our 2.5s politeness gap, so sequential requests already reuse
// one TLS connection). Built-in fetch stays.

const lastHit = new Map<string, number>();
const delays = new Map<string, number>();
const chains = new Map<string, Promise<unknown>>();
export const setHostDelay = (host: string, ms: number) => delays.set(host, Math.max(MIN_DELAY_MS, ms));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serialize request *starts* per host so concurrent callers cannot burst past the delay:
 *  each caller waits for the previous caller's turn, then for the remaining gap. */
export async function awaitTurn(host: string): Promise<void> {
  const prev = chains.get(host) ?? Promise.resolve();
  let release!: () => void;
  chains.set(host, new Promise<void>((r) => { release = r; }));
  await prev.catch(() => undefined);
  const gap = (lastHit.get(host) ?? 0) + (delays.get(host) ?? MIN_DELAY_MS) - Date.now();
  if (gap > 0) await sleep(gap);
  lastHit.set(host, Date.now());
  release();
}

export interface Got { status: number; url: string; headers: Headers; text: () => Promise<string>; body: ReadableStream<Uint8Array> | null }
export async function politeFetch(url: string, o: { accept?: string; timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<Got> {
  const host = new URL(url).host;
  await awaitTurn(host);
  const r = await fetch(url, {
    headers: { 'user-agent': UA, accept: o.accept ?? 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5', 'accept-language': 'en,ar;q=0.8', ...(o.headers ?? {}) },
    redirect: 'follow', signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
  });
  return { status: r.status, url: r.url, headers: r.headers, text: () => r.text(), body: r.body };
}
export const looksLikeChallenge = (html: string) => /captcha|cf-chl|challenge-platform|Attention Required|are you a robot/i.test(html.slice(0, 20000));

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds from `now`. Null when absent/invalid. */
export function parseRetryAfter(headers: Headers, now = Date.now()): number | null {
  const v = headers.get('retry-after')?.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}
