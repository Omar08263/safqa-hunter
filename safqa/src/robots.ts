// robots.txt via Crawlee's RobotsTxtFile parser, fetched with our honest UA. Missing robots = allowed;
// a robots.txt that answers 401/403 = the site refuses crawlers, so we stop.
import { RobotsTxtFile } from 'crawlee';
import { UA_TOKEN } from './config.ts';
import { politeFetch, setHostDelay } from './http.ts';

export interface Robots { allowed: (url: string) => boolean; sitemaps: string[]; refused: boolean }
export async function loadRobots(base: string): Promise<Robots> {
  const url = new URL('/robots.txt', base).toString();
  let body = ''; let status = 0;
  try { const r = await politeFetch(url, { accept: 'text/plain,*/*', timeoutMs: 30_000 }); status = r.status; body = r.status === 200 ? await r.text() : ''; } catch { /* unreachable = no rules */ }
  if (status === 401 || status === 403) return { allowed: () => false, sitemaps: [], refused: true };
  const rf = RobotsTxtFile.from(url, body);
  const delay = Number(body.match(/crawl-delay:\s*([\d.]+)/i)?.[1] ?? 0);
  if (delay) setHostDelay(new URL(base).host, delay * 1000);
  const sitemaps = [...body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!);
  return { allowed: (u) => rf.isAllowed(u, UA_TOKEN), sitemaps, refused: false };
}
