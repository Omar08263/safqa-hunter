// Streaming sitemap reader: handles sitemap indexes and very large single files (B.TECH's is ~45 MB / 61k URLs)
// by parsing the response body chunk by chunk instead of buffering it, with a long timeout and ETag reuse.
import { politeFetch } from '../http.ts';

export interface SmEntry { loc: string; lastmod?: string; alternates: Record<string, string> }
const decode = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').trim();

export async function* streamSitemap(url: string, o: { etag?: string; timeoutMs?: number; depth?: number; maxEntries?: number; maxNested?: number; _budget?: { left: number } } = {}): AsyncGenerator<SmEntry | { notModified: true; etag?: string } | { etag: string }> {
  // Shared entry budget across nested sitemaps: once spent, streaming stops and no further
  // nested files are fetched (the robots-fallback cap relies on this to bound total work).
  const budget = o._budget ?? { left: o.maxEntries ?? Number.POSITIVE_INFINITY };
  if (budget.left <= 0) return;
  const r = await politeFetch(url, { accept: 'application/xml,text/xml,*/*;q=0.5', timeoutMs: o.timeoutMs ?? 300_000, headers: o.etag ? { 'if-none-match': o.etag } : {} });
  if (r.status === 304) { yield { notModified: true, etag: o.etag }; return; }
  if (r.status !== 200 || !r.body) throw new Error(`sitemap ${url}: HTTP ${r.status}`);
  const etag = r.headers.get('etag'); if (etag) yield { etag };
  const gz = /\.gz$/.test(url) || /gzip/.test(r.headers.get('content-type') ?? '');
  const body = r.body as ReadableStream<any>;
  const stream: ReadableStream<any> = gz ? body.pipeThrough(new DecompressionStream('gzip') as any) : body;
  const reader = (stream.pipeThrough(new TextDecoderStream() as any) as ReadableStream<string>).getReader();
  let buf = ''; const nested: string[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += value;
      let end: number;
      while ((end = buf.search(/<\/(url|sitemap)>/)) >= 0) {
        const close = buf.indexOf('>', end) + 1;
        const block = buf.slice(0, close); buf = buf.slice(close);
        const loc = block.match(/<loc>([\s\S]*?)<\/loc>/)?.[1];
        if (!loc) continue;
        if (/<\/sitemap>$/.test(block)) { nested.push(decode(loc)); continue; }
        if (budget.left <= 0) break;
        const alternates: Record<string, string> = {};
        for (const m of block.matchAll(/<xhtml:link[^>]+hreflang="([^"]+)"[^>]+href="([^"]+)"/g)) alternates[m[1]!] = decode(m[2]!);
        budget.left--;
        yield { loc: decode(loc), lastmod: block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1], alternates };
        if (budget.left <= 0) break;
      }
      if (done || budget.left <= 0) break;
      if (buf.length > 4_000_000) buf = buf.slice(-100_000); // malformed input guard
    }
  } finally { try { await reader.cancel(); } catch { /* stream already closed */ } }
  if (budget.left > 0 && (o.depth ?? 0) < 2) for (const n of nested.slice(0, o.maxNested ?? 200)) { if (budget.left <= 0) break; yield* streamSitemap(n, { timeoutMs: o.timeoutMs, depth: (o.depth ?? 0) + 1, maxNested: o.maxNested, _budget: budget }); }
}
