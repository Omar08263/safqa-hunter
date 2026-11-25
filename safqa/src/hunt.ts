// One polite hunt over the configured stores, driven by Crawlee's BasicCrawler (queue, retries, autoscaled pool,
// statistics). Every HTTP request goes through politeFetch (honest SafqaBot UA, per-host delay); robots.txt is
// checked before anything is queued; a refusal (401/403/429/503 or a challenge page) stops that store for 24 h.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BasicCrawler, Configuration, log } from 'crawlee';
import { STOP_STATUSES } from './config.ts';
import { shopify, woocommerce } from './adapters/feeds.ts';
import { streamSitemap } from './adapters/sitemap.ts';
import { extract, type Item } from './extract/jsonld.ts';
import { looksLikeChallenge, politeFetch } from './http.ts';
import { loadRobots } from './robots.ts';
import { matchKey } from './safqa-core.ts';
import { prioritise } from './scheduler.ts';
import { getBudget, getPlan, heal, report, Sink } from './sink.ts';
import { loadState, saveState, type State } from './state.ts';
import { STORES, type Store } from './stores.ts';

Configuration.getGlobalConfig().set('persistStorage', false);
const H = 3600_000;
const itemHash = (it: Item) => createHash('sha1').update([it.title, it.price, it.listPrice, it.inStock].join('|')).digest('hex').slice(0, 16);

export interface StoreRun { store: string; status: string; candidates: number; queued: number; fetched: number; extracted: number; healed: number; unchanged: number; sink?: Sink['stats']; groups?: number; ms: number; note?: string }

export async function huntStore(s: Store, st: State, o: { max?: number; dry: boolean }): Promise<StoreRun> {
  const t0 = Date.now();
  const run: StoreRun = { store: s.id, status: 'ok', candidates: 0, queued: 0, fetched: 0, extracted: 0, healed: 0, unchanged: 0, ms: 0 };
  const done = (status: string, note?: string) => ({ ...run, status, note, ms: Date.now() - t0 });
  if (s.disabled) return done('disabled', s.disabled);
  if ((st.refusedUntil[s.id] ?? 0) > Date.now()) return done('paused', 'store refused us recently; waiting 24 h');
  const robots = await loadRobots(s.base);
  if (robots.refused) { st.refusedUntil[s.id] = Date.now() + 24 * H; return done('refused', 'robots.txt answered 401/403'); }
  const sink = new Sink(s.id, o.dry);
  const seen = (st.urls[s.id] ??= {});
  const keys = new Set<string>();
  const accept = async (it: Item) => {
    run.extracted++; keys.add(matchKey({ title: it.title, brand: it.brand, gtin: it.gtin, mpn: it.mpn }));
    const h = itemHash(it); const prev = seen[it.url];
    if (prev?.hash === h && prev.last && Date.now() - prev.last < 72 * H) { run.unchanged++; return true; } // unchanged: costs no writes
    const ok = await sink.add(it);
    seen[it.url] = { ...(prev ?? { first: Date.now() }), last: Date.now(), hash: h, fails: 0 };
    return ok;
  };

  if (s.kind !== 'sitemap') {
    const feedPath = s.kind === 'shopify' ? '/products.json' : '/wp-json/wc/store/v1/products';
    if (!robots.allowed(s.base + feedPath)) return done('robots', `${feedPath} disallowed`);
    try { for await (const it of (s.kind === 'shopify' ? shopify : woocommerce)(s.base, s.maxPages)) { run.fetched++; if (!(await accept(it))) break; } }
    catch (e) { const status = (e as { status?: number }).status; if (status && STOP_STATUSES.has(status)) { st.refusedUntil[s.id] = Date.now() + 24 * H; await sink.flush(); return done('refused', `HTTP ${status}`); } throw e; }
    await sink.flush(); run.sink = sink.stats; run.groups = keys.size;
    return done(sink.stats.budgetStop ? 'budget' : 'ok');
  }

  // 1) stream the sitemap(s) (chunked; ETag reuse when unchanged)
  const urls: string[] = [];
  for (const sm of s.sitemaps?.length ? s.sitemaps : robots.sitemaps) {
    if (!robots.allowed(sm)) continue;
    try {
      for await (const e of streamSitemap(sm, { etag: undefined })) {
        if ('etag' in e && !('loc' in e)) { if (e.etag) st.etags[sm] = e.etag; continue; }
        if ('notModified' in e) continue;
        const ent = e as { loc: string; alternates: Record<string, string> };
        const u = (s.preferLang && ent.alternates[s.preferLang]) || ent.loc;
        if (s.product?.test(u) && robots.allowed(u)) urls.push(u);
      }
    } catch (err) { log.warning(`${s.id}: ${String(err)}`); }
  }
  run.candidates = urls.length;
  const max = Math.min(o.max ?? s.maxPages, s.maxPages);
  const queue = prioritise([...new Set(urls)], seen, await getPlan(s.id), max);
  run.queued = queue.length;
  if (!queue.length) return done(urls.length ? 'idle' : 'no-urls');

  // 2) fetch product pages through Crawlee's BasicCrawler, one at a time
  let refused = '';
  const crawler = new BasicCrawler({
    maxConcurrency: 1, maxRequestRetries: 1, requestHandlerTimeoutSecs: 90, maxRequestsPerCrawl: max,
    async requestHandler({ request }) {
      if (refused || sink.stats.budgetStop) return;
      const r = await politeFetch(request.url);
      run.fetched++;
      if (STOP_STATUSES.has(r.status)) { refused = `HTTP ${r.status}`; await crawler.autoscaledPool?.abort(); return; }
      if (r.status !== 200) { const p = seen[request.url]; seen[request.url] = { ...(p ?? { first: Date.now() }), last: Date.now(), fails: (p?.fails ?? 0) + 1 }; return; }
      const html = await r.text();
      if (looksLikeChallenge(html)) { refused = 'challenge page (we never solve captchas)'; await crawler.autoscaledPool?.abort(); return; }
      const { item, candidates } = extract(html, request.url);
      let it = item;
      if (it && !it.price && candidates.length) { const ai = await heal(new URL(request.url).host, it.title, candidates); if (ai?.price) { it = { ...it, price: ai.price }; run.healed++; } }
      if (it?.title && it.price) { if (!(await accept(it))) await crawler.autoscaledPool?.abort(); }
      else { const p = seen[request.url]; seen[request.url] = { ...(p ?? { first: Date.now() }), last: Date.now(), fails: (p?.fails ?? 0) + 1 }; }
    },
    failedRequestHandler({ request }) { const p = seen[request.url]; seen[request.url] = { ...(p ?? { first: Date.now() }), last: Date.now(), fails: (p?.fails ?? 0) + 1 }; },
  });
  await crawler.run(queue.map((url) => ({ url, uniqueKey: url })));
  await sink.flush();
  if (refused) st.refusedUntil[s.id] = Date.now() + 24 * H;
  run.sink = sink.stats; run.groups = keys.size;
  return done(refused ? 'refused' : sink.stats.budgetStop ? 'budget' : 'ok', refused || undefined);
}

export async function hunt(o: { stores?: string[]; max?: number; dry: boolean; minRoom?: number }) {
  const st = loadState();
  const budget = o.dry ? null : await getBudget();
  if (!o.dry && (!budget || budget.exhausted || budget.used >= budget.bgCap - (o.minRoom ?? 3000))) {
    const r = { at: new Date().toISOString(), status: 'skipped', reason: budget?.exhausted ? 'D1 daily write limit exhausted; waiting for 00:00 UTC reset' : `write budget too low (${budget?.used ?? '?'} / ${budget?.bgCap ?? '?'})` };
    console.log(JSON.stringify(r)); await report(r); return r;
  }
  const runs: StoreRun[] = [];
  for (const s of STORES.filter((x) => (o.stores?.length ? o.stores.includes(x.id) : x.kind === 'sitemap'))) {
    try { runs.push(await huntStore(s, st, o)); } catch (e) { runs.push({ store: s.id, status: 'error', note: String(e).slice(0, 200), candidates: 0, queued: 0, fetched: 0, extracted: 0, healed: 0, unchanged: 0, ms: 0 }); }
    saveState(st);
    console.log(JSON.stringify(runs.at(-1)));
    if (runs.at(-1)?.status === 'budget') break;
  }
  const summary = { at: new Date().toISOString(), dry: o.dry, stores: runs, totals: { fetched: runs.reduce((a, r) => a + r.fetched, 0), sent: runs.reduce((a, r) => a + (r.sink?.sent ?? 0), 0), created: runs.reduce((a, r) => a + (r.sink?.created ?? 0), 0) }, budgetAfter: o.dry ? null : await getBudget() };
  mkdirSync('out', { recursive: true }); writeFileSync('out/health.json', JSON.stringify(summary, null, 2));
  if (!o.dry) await report({ status: 'done', ...summary, stores: runs.map((r) => `${r.store}:${r.status}:${r.fetched}/${r.queued}${r.sink ? `→${r.sink.created}+${r.sink.merged}` : ''}${r.note ? ` (${r.note})` : ''}`) });
  return summary;
}
