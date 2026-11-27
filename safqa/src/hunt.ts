// One polite hunt over the configured stores, driven by Crawlee's BasicCrawler (queue, retries, autoscaled pool,
// statistics). Every HTTP request goes through politeFetch (honest SafqaBot UA, per-host delay); robots.txt is
// checked before anything is queued. An explicit refusal (401/403 or a challenge page) stops that store for 24 h
// and is never evaded; a throttle signal (429/503) stops the run for that store and honours Retry-After.
// Sitemaps and product pages use conditional requests (ETag/Last-Modified): unchanged pages cost no body,
// no parse and no writes. Stores run in parallel (different hosts; the per-host delay still applies).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BasicCrawler, Configuration, log } from 'crawlee';
import { cooldownMs, HEAL_CAP, MIN_ROOM, REFUSAL_STATUSES, THROTTLE_STATUSES, TIGHT_ROOM, UNCHANGED_WINDOW_MS } from './config.ts';
import { browserFetch, closeBrowser } from './browser.ts';
import { shopify, woocommerce } from './adapters/feeds.ts';
import { streamSitemap } from './adapters/sitemap.ts';
import { extract, type Item } from './extract/jsonld.ts';
import { looksLikeChallenge, parseRetryAfter, politeFetch } from './http.ts';
import { loadRobots } from './robots.ts';
import { countAnomalies, matchKey, plausibleEgp } from './safqa-core.ts';
import { prioritise } from './scheduler.ts';
import { getBudget, getPlan, heal, report, Sink } from './sink.ts';
import { loadState, saveState, type State } from './state.ts';
import { checkItem } from './validate.ts';
import { guarded, throttledHeal } from './resilience.ts';
import { log as plog, storeLog } from './log.ts';
import { STORES, type Store } from './stores.ts';

Configuration.getGlobalConfig().set('persistStorage', false);
const H = 3600_000;
const itemHash = (it: Item) => createHash('sha1').update([it.title, it.price, it.listPrice, it.inStock].join('|')).digest('hex').slice(0, 16);

export interface StoreRun { store: string; status: string; candidates: number; queued: number; fetched: number; extracted: number; healed: number; unchanged: number; invalid?: number; anomalies?: number; sink?: Sink['stats']; groups?: number; ms: number; note?: string }

export async function huntStore(s: Store, st: State, o: { max?: number; dry: boolean; tight?: boolean }): Promise<StoreRun> {
  const t0 = Date.now();
  const run: StoreRun = { store: s.id, status: 'ok', candidates: 0, queued: 0, fetched: 0, extracted: 0, healed: 0, unchanged: 0, ms: 0 };
  const slog = storeLog(s.id);
  const done = (status: string, note?: string) => { const r = { ...run, status, note, ms: Date.now() - t0 }; slog.info({ run: r }, 'store run finished'); return r; };
  // Graduated escalation: a refusal is never final — re-test after 1 h, then 3/6/12/24 h if it repeats;
  // any successful fetch resets the ladder. Throttles (429/503) use the server's Retry-After when given.
  const noteRefusal = (ms?: number) => { const n = (st.refusals[s.id] ?? 0) + 1; st.refusals[s.id] = n; st.refusedUntil[s.id] = Date.now() + (ms ?? cooldownMs(n)); };
  if (s.disabled) return done('disabled', s.disabled);
  if ((st.refusedUntil[s.id] ?? 0) > Date.now()) return done('paused', 'store refused us recently; cooling down (graduated)');
  const robots = await loadRobots(s.base);
  if (robots.refused) { noteRefusal(); return done('refused', 'robots.txt answered 401/403'); }
  const sink = new Sink(s.id, o.dry);
  const seen = (st.urls[s.id] ??= {});
  const keys = new Set<string>();
  const priced: { key: string; price: number }[] = [];
  const accept = async (raw: Item, validators?: { etag?: string; lastModified?: string }) => {
    run.extracted++;
    const prev = seen[raw.url];
    const checked = checkItem(raw); // Zod gate: price>0, EGP, valid URL, non-empty title — before anything reaches D1
    if (!checked.ok) {
      run.invalid = (run.invalid ?? 0) + 1;
      seen[raw.url] = { ...(prev ?? { first: Date.now() }), last: Date.now(), fails: (prev?.fails ?? 0) + 1, scrapeStatus: 'failed' };
      return true;
    }
    const it = checked.item;
    if (!plausibleEgp(it.price)) { // NaN/0/placeholder/absurd price: never sent; back the URL off like a failure
      // scrapeStatus records the failure WITHOUT touching hash/sentAt: the last known-good value stays authoritative.
      seen[it.url] = { ...(prev ?? { first: Date.now() }), last: Date.now(), fails: (prev?.fails ?? 0) + 1, scrapeStatus: 'failed' };
      return true;
    }
    const key = matchKey({ title: it.title, brand: it.brand, gtin: it.gtin, mpn: it.mpn });
    keys.add(key);
    if (it.price) priced.push({ key, price: it.price });
    const h = itemHash(it);
    const keepValidators = { ...(validators?.etag ? { etag: validators.etag } : {}), ...(validators?.lastModified ? { lastModified: validators.lastModified } : {}) };
    // Delta-only, strictly: an item whose fingerprint did not change is re-sent only when the refresh
    // window since its last SEND has elapsed (legacy rows without sentAt fall back to last fetch).
    const lastSent = prev?.sentAt ?? prev?.last;
    if (prev?.hash === h && lastSent && Date.now() - lastSent < UNCHANGED_WINDOW_MS) { seen[it.url] = { ...prev, last: Date.now(), scrapeStatus: 'unchanged', ...keepValidators }; run.unchanged++; return true; } // unchanged: costs no writes
    const ok = await sink.add(it);
    seen[it.url] = { ...(prev ?? { first: Date.now() }), last: Date.now(), hash: h, fails: 0, sentAt: Date.now(), changes: (prev?.changes ?? 0) + (prev?.hash && prev.hash !== h ? 1 : 0), scrapeStatus: 'ok', ...keepValidators };
    return ok;
  };

  if (s.kind !== 'sitemap') {
    const feedPath = s.kind === 'shopify' ? '/products.json' : '/wp-json/wc/store/v1/products';
    if (!robots.allowed(s.base + feedPath)) return done('robots', `${feedPath} disallowed`);
    try { for await (const it of (s.kind === 'shopify' ? shopify : woocommerce)(s.base, s.maxPages)) { run.fetched++; if (!(await accept(it))) break; } }
    catch (e) {
      const status = (e as { status?: number }).status; const ra = (e as { retryAfterMs?: number | null }).retryAfterMs;
      if (status && REFUSAL_STATUSES.has(status)) { noteRefusal(); await sink.flush(); return done('refused', `HTTP ${status}`); }
      if (status && THROTTLE_STATUSES.has(status)) { noteRefusal(Math.min(ra ?? cooldownMs((st.refusals[s.id] ?? 0) + 1), 24 * H)); await sink.flush(); return done('refused', `HTTP ${status} (Retry-After honoured)`); }
      throw e;
    }
    await sink.flush(); run.sink = sink.stats; run.groups = keys.size; run.anomalies = countAnomalies(priced);
    if (run.fetched > 0) st.refusals[s.id] = 0; // store answered: reset the escalation ladder
    return done(sink.stats.budgetStop ? 'budget' : 'ok');
  }

  // 1) stream the sitemap(s) (chunked; ETag reuse when unchanged — a 304 replays the cached entry list).
  //    If the configured sitemaps yield nothing, fall back to the sitemaps robots.txt declares.
  const urls: string[] = [];
  const lastmods: Record<string, string> = {};
  const collectSitemaps = async (list: string[]) => {
  for (const sm of list) {
    if (!robots.allowed(sm)) continue;
    const cached = st.sitemapCache[sm];
    const fresh: { loc: string; lastmod?: string; alternates: Record<string, string> }[] = [];
    let notModified = false;
    const collect = async (etag?: string) => {
      for await (const e of streamSitemap(sm, { etag })) {
        if ('etag' in e && !('loc' in e)) { if (e.etag) st.etags[sm] = e.etag; continue; }
        if ('notModified' in e) { notModified = true; continue; }
        fresh.push(e as { loc: string; lastmod?: string; alternates: Record<string, string> });
      }
    };
    try {
      // Only send the ETag when we hold the entry list to replay on a 304; a bare ETag
      // (state written before the cache existed) would turn a 304 into an empty store.
      await collect(cached?.entries?.length ? cached.etag : undefined);
      if (notModified && !cached?.entries?.length) { notModified = false; await collect(undefined); }
    } catch (err) { log.warning(`${s.id}: ${String(err)}`); }
    if (!notModified && fresh.length) st.sitemapCache[sm] = { etag: st.etags[sm], entries: fresh };
    const entries = notModified && cached ? cached.entries : fresh.length ? fresh : (cached?.entries ?? []);
    for (const ent of entries) {
      const u = (s.preferLang && ent.alternates[s.preferLang]) || ent.loc;
      if (s.product?.test(u) && robots.allowed(u)) { urls.push(u); if (ent.lastmod) lastmods[u] = ent.lastmod; }
    }
  }
  };
  await collectSitemaps(s.sitemaps?.length ? s.sitemaps : robots.sitemaps);
  if (!urls.length && s.sitemaps?.length && robots.sitemaps.length) await collectSitemaps(robots.sitemaps);
  run.candidates = urls.length;
  const max = Math.min(o.max ?? s.maxPages, s.maxPages);
  const queue = prioritise([...new Set(urls)], seen, o.tight ? [] : await getPlan(s.id), max, Date.now(), lastmods); // tight budget: skip the plan read
  run.queued = queue.length;
  if (!queue.length) return done(urls.length ? 'idle' : 'no-urls');

  // 2) fetch product pages through Crawlee's BasicCrawler. Concurrency 2 only overlaps fetch/parse/heal latency:
  //    politeFetch still enforces the per-host delay between request starts, so the per-host rate is unchanged.
  let refused = '';
  let refusedMs: number | undefined; // undefined = graduated ladder step; set only for throttles (Retry-After)
  let browserBudget = 10; // browser-grade renders per store run (JS-only public pages)
  const browserDeadline = Date.now() + 120_000; // total browser time per store run is capped at 2 min
  let firstHtml = ''; // kept for the extraction-break snapshot below
  const crawler = new BasicCrawler({
    maxConcurrency: 2, maxRequestRetries: 1, requestHandlerTimeoutSecs: 90, maxRequestsPerCrawl: max,
    async requestHandler({ request }) {
      if (refused || sink.stats.budgetStop) return;
      const prev = seen[request.url];
      const cond: Record<string, string> = {};
      if (prev?.etag) cond['if-none-match'] = prev.etag;
      if (prev?.lastModified) cond['if-modified-since'] = prev.lastModified;
      const r = await politeFetch(request.url, { headers: cond });
      run.fetched++;
      if (r.status === 304) { seen[request.url] = { ...(prev ?? { first: Date.now() }), last: Date.now(), fails: 0, scrapeStatus: 'unchanged' }; run.unchanged++; return; } // unchanged: no body, no parse, no writes
      if (REFUSAL_STATUSES.has(r.status)) { refused = `HTTP ${r.status}`; await crawler.autoscaledPool?.abort(); return; }
      if (THROTTLE_STATUSES.has(r.status)) { refused = `HTTP ${r.status}`; refusedMs = Math.min(parseRetryAfter(r.headers) ?? cooldownMs((st.refusals[s.id] ?? 0) + 1), 24 * H); await crawler.autoscaledPool?.abort(); return; }
      if (r.status !== 200) { const p = seen[request.url]; seen[request.url] = { ...(p ?? { first: Date.now() }), last: Date.now(), fails: (p?.fails ?? 0) + 1 }; return; }
      const html = await r.text();
      if (!firstHtml) firstHtml = html;
      if (looksLikeChallenge(html)) { refused = 'challenge page (we never solve captchas)'; await crawler.autoscaledPool?.abort(); return; }
      const validators = { etag: r.headers.get('etag') ?? undefined, lastModified: r.headers.get('last-modified') ?? undefined };
      let { item, candidates, pageTitle } = extract(html, request.url);
      if (!item && !candidates.length && browserBudget > 0 && Date.now() < browserDeadline) {
        // Public page answered 200 but carries no structured price and no price-like text:
        // it may render prices with JS. One browser-grade render (honest UA, same delay) — never for refusals.
        browserBudget--;
        const rendered = await browserFetch(request.url);
        if (rendered && !looksLikeChallenge(rendered)) ({ item, candidates, pageTitle } = extract(rendered, request.url));
      }
      let it = item;
      // Self-heal is capped per store run (each call costs a Worker request + potential writes),
      // throttled (<=2 in flight, 1 start/s) and behind the store's circuit breaker.
      const tryHeal = async (title: string) => guarded(s.id, async () => {
        const r = await throttledHeal(() => heal(new URL(request.url).host, title, candidates));
        if (!r) throw new Error('heal returned nothing');
        return r;
      });
      if (it && !it.price && candidates.length && run.healed < HEAL_CAP) { const ai = await tryHeal(it.title); if (ai?.price && plausibleEgp(ai.price)) { it = { ...it, price: ai.price }; run.healed++; } }
      if (!it && candidates.length && pageTitle && run.healed < HEAL_CAP) { const ai = await tryHeal(pageTitle); if (ai?.price && plausibleEgp(ai.price)) { it = { url: request.url, title: pageTitle, brand: null, price: ai.price, listPrice: null, currency: 'EGP', inStock: true, image: null, gtin: null, mpn: null, crumbs: [] }; run.healed++; } }
      if (it?.title && it.price) { if (!(await accept(it, validators))) await crawler.autoscaledPool?.abort(); }
      else { const p = seen[request.url]; seen[request.url] = { ...(p ?? { first: Date.now() }), last: Date.now(), fails: (p?.fails ?? 0) + 1 }; }
    },
    failedRequestHandler({ request }) { const p = seen[request.url]; seen[request.url] = { ...(p ?? { first: Date.now() }), last: Date.now(), fails: (p?.fails ?? 0) + 1 }; },
  });
  await crawler.run(queue.map((url) => ({ url, uniqueKey: url })));
  await sink.flush();
  // Extraction-break detection: pages answered but nothing extracted → the store likely changed its
  // markup. Keep one HTML snapshot in the run artifact so the extractor can be repaired from evidence.
  if (!refused && run.fetched >= 10 && run.extracted === 0 && firstHtml) {
    try { mkdirSync('out', { recursive: true }); writeFileSync(`out/${s.id}-break.html`, firstHtml); } catch { /* snapshot is best-effort */ }
  }
  if (refused) noteRefusal(refusedMs);
  else if (run.fetched > 0) st.refusals[s.id] = 0; // store answered: reset the escalation ladder
  run.sink = sink.stats; run.groups = keys.size; run.anomalies = countAnomalies(priced);
  return done(refused ? 'refused' : sink.stats.budgetStop ? 'budget' : 'ok', refused || undefined);
}

export async function hunt(o: { stores?: string[]; max?: number; dry: boolean; minRoom?: number }) {
  const st = loadState();
  const budget = o.dry ? null : await getBudget();
  const room = budget ? budget.bgCap - budget.used : Infinity;
  const tight = !o.dry && room < TIGHT_ROOM; // tight budget: no plan reads, no report writes
  if (!o.dry && (!budget || budget.exhausted || room < (o.minRoom ?? MIN_ROOM))) {
    const r = { at: new Date().toISOString(), status: 'skipped', reason: budget?.exhausted ? 'D1 daily write limit exhausted; waiting for 00:00 UTC reset' : `write budget too low (${budget?.used ?? '?'} / ${budget?.bgCap ?? '?'})` };
    plog.warn({ run: r }, 'hunt skipped'); console.log(JSON.stringify(r)); if (!budget?.exhausted) await report(r); return r;
  }
  // Stores are different hosts, so they hunt in parallel: the per-host delay still applies to every host,
  // and the shared D1 write budget is enforced server-side per batch (each sink stops on its budget flag).
  const targets = STORES.filter((x) => (o.stores?.length ? o.stores.includes(x.id) : x.kind === 'sitemap'));
  const runs: StoreRun[] = await Promise.all(targets.map(async (s) => {
    try { return await huntStore(s, st, { ...o, tight }); } catch (e) { return { store: s.id, status: 'error', note: String(e).slice(0, 200), candidates: 0, queued: 0, fetched: 0, extracted: 0, healed: 0, unchanged: 0, ms: 0 } as StoreRun; }
  }));
  await closeBrowser();
  saveState(st);
  for (const r of runs) console.log(JSON.stringify(r));
  plog.info({ stores: runs.length, fetched: runs.reduce((a, r) => a + r.fetched, 0), sent: runs.reduce((a, r) => a + (r.sink?.sent ?? 0), 0), unchanged: runs.reduce((a, r) => a + r.unchanged, 0) }, 'hunt finished');
  const summary = { at: new Date().toISOString(), dry: o.dry, stores: runs, totals: { fetched: runs.reduce((a, r) => a + r.fetched, 0), sent: runs.reduce((a, r) => a + (r.sink?.sent ?? 0), 0), created: runs.reduce((a, r) => a + (r.sink?.created ?? 0), 0) }, budgetAfter: o.dry ? null : await getBudget() };
  mkdirSync('out', { recursive: true }); writeFileSync('out/health.json', JSON.stringify(summary, null, 2));
  if (!o.dry && !tight) await report({ status: 'done', ...summary, stores: runs.map((r) => `${r.store}:${r.status}:${r.fetched}/${r.queued}${r.sink ? `→${r.sink.created}+${r.sink.merged}` : ''}${r.note ? ` (${r.note})` : ''}`) });
  return summary;
}
