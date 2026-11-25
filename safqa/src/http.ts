// The only network path the hunter uses: plain fetch with an honest SafqaBot User-Agent.
// Crawlee's default got-scraping client generates browser-like fingerprint headers; we deliberately do not use it.
import { MIN_DELAY_MS, UA } from './config.ts';

const lastHit = new Map<string, number>();
const delays = new Map<string, number>();
export const setHostDelay = (host: string, ms: number) => delays.set(host, Math.max(MIN_DELAY_MS, ms));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Got { status: number; url: string; headers: Headers; text: () => Promise<string>; body: ReadableStream<Uint8Array> | null }
export async function politeFetch(url: string, o: { accept?: string; timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<Got> {
  const host = new URL(url).host;
  const gap = (lastHit.get(host) ?? 0) + (delays.get(host) ?? MIN_DELAY_MS) - Date.now();
  if (gap > 0) await sleep(gap);
  lastHit.set(host, Date.now());
  const r = await fetch(url, {
    headers: { 'user-agent': UA, accept: o.accept ?? 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5', 'accept-language': 'en,ar;q=0.8', ...(o.headers ?? {}) },
    redirect: 'follow', signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
  });
  return { status: r.status, url: r.url, headers: r.headers, text: () => r.text(), body: r.body };
}
export const looksLikeChallenge = (html: string) => /captcha|cf-chl|challenge-platform|Attention Required|are you a robot/i.test(html.slice(0, 20000));
