# safqa-hunter

**safqa-hunter** is [Safqa](https://safqaeg.pages.dev)'s price-ingestion engine. It is a fork of
[Crawlee](https://github.com/apify/crawlee) by [Apify](https://apify.com), licensed Apache-2.0. Upstream code is
unchanged and keeps its license (`LICENSE.md`). Safqa's additions live in [`safqa/`](safqa/) and
`.github/workflows/safqa-*.yml`.

## Why Crawlee (evaluated Nov 2026)

| Candidate | License | Verdict |
|---|---|---|
| **Crawlee** (JS/TS) | Apache-2.0 | **Picked.** Same language as Safqa, request queue, retries, autoscaled pool, and a robots.txt parser with crawl-delay. |
| Scrapy | BSD-3 | Excellent, but Python; Safqa's matching code is TypeScript. |
| Crawl4AI | Apache-2.0 | Browser- and LLM-centric; heavy for structured price data. |
| Firecrawl (self-host) | AGPL-3.0 | Copyleft, plus a Redis/Playwright/API stack to host. |
| ScrapeGraphAI | MIT | An LLM call per page; too costly on free tiers. |
| trafilatura / extruct | Apache-2.0 / BSD | Great extractors (article text / structured data). We re-implemented the extruct idea (JSON-LD + OpenGraph) in TS. |

## Safqa plugins (`safqa/src`)

- `http.ts`: the only network path. Plain `fetch` with an honest `SafqaBot/5.0` User-Agent and a per-host delay of at least 2.5 s, raised by Crawl-delay. Crawlee's default got-scraping client generates browser fingerprints, so it is **deliberately not used**.
- `robots.ts`: robots.txt through Crawlee's `RobotsTxtFile`, fetched as SafqaBot. A 401/403 robots.txt is treated as a refusal.
- `adapters/`: a streaming sitemap reader (chunked; handles 45 MB single files, indexes and .gz, plus ETags), and Shopify `/products.json` and WooCommerce Store API adapters.
- `extract/jsonld.ts`: schema.org Product (JSON-LD, @graph, variants, Offer/AggregateOffer) with OpenGraph as fallback. When no price is found, it collects price-like candidates for **AI self-healing** through the Safqa API (Workers AI, daily-capped).
- `safqa-core.ts`: Safqa's cross-store matching (GTIN → MPN → brand + model tokens + storage/RAM), identical to the Worker's.
- `scheduler.ts`: adaptive priority, in order: watched/hot products that are due, new sitemap arrivals, then the stalest pages.
- `sink.ts`: a **write-budget-aware sink**. It sends 6-item batches to the Safqa Worker, which does matching, price history and the D1 budget, and stops when the API reports the budget is used up. The crawler never holds a Cloudflare credential, only `SAFQA_HUNTER_TOKEN`.
- Health: every run is reported to `/api/v5/health` (`hunter`), shown on safqaeg.pages.dev/sources and in the Hub; `out/health.json` is uploaded as an artifact.
- `cli.ts`: `hunt`, `probe <url>` (store-adapter generator) and `budget`.

## Rules that are not configurable

We identify as SafqaBot, obey robots.txt, and stop a store for 24 h on 401/403/429/503 or a challenge page.
There is no proxy rotation, no UA spoofing and no captcha solving. Sites that refuse us (for example El Araby)
stay on legitimate paths: pasted links, the browser extension, and official affiliate APIs/feeds.

## CI (GitHub Actions, free on public repos)

Workflow files are staged in `safqa/ci/workflows/`. Adding them needs the `workflow` OAuth scope once: run `gh auth refresh -h github.com -s workflow`, then `bash safqa/ci/install-workflows.sh && git push`. Until then, the same hunt runs from the Safqa box.

- `safqa-hunt`: daily at 02:40 Cairo, after D1's 00:00 UTC reset; can also be dispatched manually or as a dry run.
- `safqa-ci`: typecheck and tests.
- `safqa-upstream-sync`: weekly. It opens a PR from `apify:master` into `safqa`; nothing is auto-merged.

Note: GitHub pauses scheduled workflows after 60 days without repository activity. Merging a sync PR keeps them alive.
