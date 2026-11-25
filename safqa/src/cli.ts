#!/usr/bin/env node
// safqa-hunter CLI
//   tsx src/cli.ts hunt [--stores btech,2b] [--max 500] [--dry]
//   tsx src/cli.ts probe https://store.example     store-adapter generator (robots, feeds, sitemap, JSON-LD)
//   tsx src/cli.ts budget                           today's D1 write budget as the Safqa API sees it
import { STOP_STATUSES, UA } from './config.ts';
import { streamSitemap } from './adapters/sitemap.ts';
import { extract } from './extract/jsonld.ts';
import { politeFetch } from './http.ts';
import { hunt } from './hunt.ts';
import { loadRobots } from './robots.ts';
import { getBudget } from './sink.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const cmd = args[0];

async function probe(input: string) {
  const base = new URL(input).origin; const host = new URL(base).hostname.replace(/^www\./, '');
  console.log(`probing ${base} as ${UA}`);
  const robots = await loadRobots(base);
  if (robots.refused) return console.log('robots.txt refuses crawlers: stop (no evasion).');
  let kind = '';
  for (const [k, path] of [['shopify', '/products.json?limit=1'], ['woocommerce', '/wp-json/wc/store/v1/products?per_page=1']] as const) {
    if (kind || !robots.allowed(base + path)) continue;
    const r = await politeFetch(base + path, { accept: 'application/json' }).catch(() => null);
    if (r?.status === 200) { try { const j = JSON.parse(await r.text()); if ((k === 'shopify' && j.products) || (k === 'woocommerce' && Array.isArray(j))) kind = k; } catch { /* not json */ } }
    if (r && STOP_STATUSES.has(r.status)) return console.log(`HTTP ${r.status}: the site refuses our honest bot; stop.`);
  }
  if (kind) return console.log(`public ${kind} feed found.\n  { id: '${host.split('.')[0]}', base: '${base}', kind: '${kind}', maxPages: 40 },`);
  const sm = robots.sitemaps[0] ?? `${base}/sitemap.xml`; const sample: string[] = [];
  try { for await (const e of streamSitemap(sm, { timeoutMs: 300_000 })) { if ('loc' in e && /\d|-[a-z]+-[a-z]+-/.test(e.loc)) sample.push(e.loc); if (sample.length >= 200) break; } } catch (e) { console.log(String(e)); }
  console.log(`sitemap ${sm}: sampled ${sample.length} urls`);
  const u = sample.find((x) => robots.allowed(x));
  if (!u) return console.log('no crawlable product URLs found; use paste-a-link or the extension for this store.');
  const r = await politeFetch(u); const { item, candidates } = extract(r.status === 200 ? await r.text() : '', u);
  console.log(`sample ${u}: HTTP ${r.status}; structured price: ${item?.price ?? 'none'}; price-like candidates: ${candidates.length}`);
  const re = new URL(u).pathname.replace(/[a-z0-9]+(?:-[a-z0-9]+)+/i, '[a-z0-9-]+').replace(/\d+/g, '\\d+').replace(/\//g, '\\/');
  console.log(`  { id: '${host.split('.')[0]}', base: '${base}', kind: 'sitemap', sitemaps: ['${sm}'], product: /${re}$/, maxPages: 300 },`);
}

if (cmd === 'hunt') {
  const r = await hunt({ stores: opt('stores')?.split(',').filter(Boolean), max: Number(opt('max')) || undefined, dry: args.includes('--dry') });
  console.log(JSON.stringify((r as { totals?: unknown }).totals ?? r));
} else if (cmd === 'probe' && args[1]) await probe(args[1]);
else if (cmd === 'budget') console.log(JSON.stringify(await getBudget(), null, 2));
else console.log('usage: hunt [--stores a,b] [--max N] [--dry] | probe <url> | budget');
