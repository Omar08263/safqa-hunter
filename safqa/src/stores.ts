// Store adapters. kind: 'sitemap' = robots-listed sitemap + schema.org JSON-LD on product pages;
// 'shopify' / 'woocommerce' = the store's public catalogue feed. Disabled stores carry the reason.
export interface Store {
  id: string; base: string; kind: 'sitemap' | 'shopify' | 'woocommerce';
  sitemaps?: string[]; product?: RegExp; preferLang?: string; maxPages: number; disabled?: string;
}
export const STORES: Store[] = [
  { id: 'btech', base: 'https://btech.com', kind: 'sitemap', sitemaps: ['https://btech.com/sitemap.xml'], product: /\/p\/[^/]+$/, preferLang: 'en', maxPages: 3000 },
  { id: '2b', base: 'https://2b.com.eg', kind: 'sitemap', sitemaps: ['https://2b.com.eg/en_sitemap.xml'], product: /\/en\/[a-z0-9-]*\d[a-z0-9-]*(\.html)?$/, maxPages: 400 },
  { id: 'raya', base: 'https://www.rayashop.com', kind: 'sitemap', sitemaps: ['https://www.rayashop.com/en-sitemap.xml'], product: /\/en\/(?=[^/]*\d)[a-z0-9]+(?:-[a-z0-9]+){4,}$/, maxPages: 400 },
  { id: 'sigma', base: 'https://sigma-computer.com', kind: 'sitemap', sitemaps: ['https://sigma-computer.com/en/item/sitemap.xml'], product: /\/en\/item\?id=/, maxPages: 300 },
  { id: 'elbadr', base: 'https://elbadrgroupeg.store', kind: 'sitemap', sitemaps: [1, 2, 3, 4, 5].map((n) => `https://elbadrgroupeg.store/sitemap-product-${n}.xml`), product: /./, maxPages: 300 },
  { id: 'jumia', base: 'https://www.jumia.com.eg', kind: 'sitemap', sitemaps: [1, 2, 3].map((n) => `https://static.jumia.com.eg/products-sitemap-${n}.xml.gz`), product: /-\d+\.html$/, maxPages: 200 },
  { id: 'elaraby', base: 'https://www.elarabygroup.com', kind: 'sitemap', maxPages: 0, disabled: 'answers 404 to SafqaBot on every URL (Nov 2026); no public feed found; we do not evade' },
  // The Worker already polls these Shopify feeds every 10 min; the hunter only backfills them on demand.
  { id: 'dream2000', base: 'https://www.dream2000.com', kind: 'shopify', maxPages: 40 }, // public Shopify feed verified by probe 2026-11-27
  { id: 'kimo', base: 'https://kimostore.net', kind: 'shopify', maxPages: 40 },
  { id: 'compumarts', base: 'https://www.compumarts.com', kind: 'shopify', maxPages: 40 },
  { id: 'tradeline', base: 'https://tradelinestores.com', kind: 'shopify', maxPages: 20 },
  // Wave 2 expansion (live probe 2026-11-27, legitimate channels only: robots-declared sitemaps,
  // public Shopify /products.json, WooCommerce Store API). Sitemap product regexes are from sampled URLs.
  // Spinneys robots forbids /api/ and /graphql: sitemap + public pages only. Products are single-segment
  // /en/<slug> (12k+ in en-sitemap.xml); categories are multi-segment.
  { id: 'spinneys', base: 'https://spinneys-egypt.com', kind: 'sitemap', sitemaps: ['https://mcprod.spinneys-egypt.com/media/en-sitemap.xml'], product: /\/en\/[^/]+$/, maxPages: 300 },
  { id: 'seif', base: 'https://seif-online.com', kind: 'sitemap', sitemaps: ['https://seif-online.com/sitemap_products_en.xml'], product: /\/en\/[^/]+$/, maxPages: 300 },
  { id: 'chefaa', base: 'https://chefaa.com', kind: 'sitemap', sitemaps: ['https://chefaa.com/eg-ar/store_sitemap.xml'], product: /\/nowProduct\/[^/]+$/, maxPages: 200 },
  { id: 'decathlon', base: 'https://www.decathlon.eg', kind: 'sitemap', sitemaps: ['https://www.decathlon.eg/sitemap-en-index.xml'], product: /\/en\/p\/[^/]+\.html$/, maxPages: 300 },
  // IKEA EG product pages carry no JSON-LD in the first bytes, but the extractor's structured layers
  // verified live 2026-11-27 (EGP price read from a sample /eg/en/p/ page).
  { id: 'ikea', base: 'https://www.ikea.com', kind: 'sitemap', sitemaps: [1, 2, 3, 4, 5].map((n) => `https://www.ikea.com/sitemaps/prod-en-EG_${n}.xml`), product: /\/eg\/en\/p\/[^/]+\/$/, maxPages: 300 },
  // Homzmart sitemap is small (274 URLs, mostly categories + some /p/ products with full JSON-LD EGP).
  // A polite category crawl would widen coverage later; not built yet — sitemap only for now.
  { id: 'homzmart', base: 'https://homzmart.com', kind: 'sitemap', sitemaps: ['https://homzmart.com/sitemap.xml'], product: /\/p\/[^/]+$/, maxPages: 100 },
  // iMedia: sitemap only. Its Store API / products.json answer 403 (Imunify360) — never used.
  { id: 'imedia', base: 'https://www.imediastores.com', kind: 'sitemap', sitemaps: ['https://www.imediastores.com/product-sitemap.xml', ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((n) => `https://www.imediastores.com/product-sitemap${n}.xml`)], product: /\/product\/[^/]+\/$/, maxPages: 300 },
  { id: 'kenzz', base: 'https://kenzz.com', kind: 'sitemap', sitemaps: ['https://kenzz.com/sitemap.xml'], product: /\/en\/product\/[^/]+\/[^/]+$/, maxPages: 300 },
  { id: 'activ', base: 'https://activ.eg', kind: 'shopify', maxPages: 40 },
  { id: 'sourcebeauty', base: 'https://sourcebeauty.com', kind: 'shopify', maxPages: 40 },
  { id: 'azzam', base: 'https://azzampharmacy.com', kind: 'shopify', maxPages: 80 },
  { id: 'wayup', base: 'https://wayupsports.com', kind: 'shopify', maxPages: 100 },
  { id: 'mlameh', base: 'https://mlameh.com', kind: 'shopify', maxPages: 40 },
  { id: 'bloom', base: 'https://bloompharmacy.com', kind: 'shopify', maxPages: 40 },
  { id: 'eloutlet', base: 'https://eloutleteg.com', kind: 'shopify', maxPages: 40 },
  { id: 'almicrophone', base: 'https://almicrophone.net', kind: 'woocommerce', maxPages: 80 },
  { id: 'egytools', base: 'https://egytools.net', kind: 'woocommerce', maxPages: 50 },
  // Gourmet: the 2023 sitemap was replaced (4312 URLs at probe 2026-11-27); deep links answer 200 with
  // extractable prices, though some stale 404s remain — per-URL fail backoff absorbs those.
  { id: 'gourmet', base: 'https://gourmetegypt.com', kind: 'sitemap', sitemaps: ['https://gourmetegypt.com/sitemap.xml'], product: /\/[^/]+\/[^/]+$/, maxPages: 100 },
  // Explicit refusals (probe 2026-11-27): declared/standard channel kept so the graduated refusal
  // ladder re-tests them automatically. A refusal is never final and never evaded.
  { id: 'amazon', base: 'https://www.amazon.eg', kind: 'sitemap', sitemaps: ['https://www.amazon.eg/sitemap.xml'], product: /./, maxPages: 100 }, // 503 on every channel
  { id: 'hyperone', base: 'https://hyperone.com.eg', kind: 'sitemap', sitemaps: ['https://hyperone.com.eg/sitemap.xml'], product: /./, maxPages: 100 }, // robots 403
  { id: 'talabat', base: 'https://www.talabat.com', kind: 'sitemap', sitemaps: ['https://www.talabat.com/sitemap.xml'], product: /./, maxPages: 100 }, // Cloudflare 403
  { id: 'sharafdg', base: 'https://egypt.sharafdg.com', kind: 'sitemap', sitemaps: ['https://egypt.sharafdg.com/sitemap.xml'], product: /./, maxPages: 100 }, // Cloudflare 403
  { id: 'lcwaikiki', base: 'https://www.lcwaikiki.eg', kind: 'sitemap', sitemaps: ['https://www.lcwaikiki.eg/sitemap.xml'], product: /./, maxPages: 100 }, // Cloudflare 403
  { id: 'hm', base: 'https://eg.hm.com', kind: 'sitemap', sitemaps: ['https://eg.hm.com/sitemap.xml'], product: /./, maxPages: 100 }, // Cloudflare 403
  { id: 'zara', base: 'https://www.zara.com', kind: 'sitemap', sitemaps: ['https://www.zara.com/sitemap.xml'], product: /./, maxPages: 100 }, // Akamai 403
  { id: 'lulu', base: 'https://www.luluhypermarket.com', kind: 'sitemap', sitemaps: ['https://www.luluhypermarket.com/sitemap.xml'], product: /./, maxPages: 100 }, // sitemap 403 Cloudflare
  { id: 'maxfashion', base: 'https://www.maxfashion.com', kind: 'sitemap', sitemaps: ['https://www.maxfashion.com/sitemap.xml'], product: /./, maxPages: 100 }, // Cloudflare 403
  { id: 'defacto', base: 'https://www.defacto.com', kind: 'sitemap', sitemaps: ['https://www.defacto.com/sitemap.xml'], product: /./, maxPages: 100 }, // Akamai 403
  { id: 'mango', base: 'https://www.mango.com', kind: 'sitemap', sitemaps: ['https://www.mango.com/sitemap.xml'], product: /./, maxPages: 100 }, // Akamai 403
  { id: 'adidas', base: 'https://www.adidas.com.eg', kind: 'sitemap', sitemaps: ['https://www.adidas.com.eg/sitemap.xml'], product: /./, maxPages: 100 }, // Akamai 403
  { id: 'samsung', base: 'https://www.samsung.com', kind: 'sitemap', sitemaps: ['https://www.samsung.com/sitemap.xml'], product: /./, maxPages: 100 }, // Akamai 403
  { id: 'xiaomi', base: 'https://www.mi.com', kind: 'sitemap', sitemaps: ['https://www.mi.com/sitemap.xml'], product: /./, maxPages: 100 }, // Akamai 403
  { id: 'radioshack', base: 'https://radioshack.com.eg', kind: 'sitemap', sitemaps: ['https://radioshack.com.eg/sitemap.xml'], product: /./, maxPages: 100 }, // declared sitemap answers 403 Imunify360
  { id: 'hedeya', base: 'https://hedeya.com', kind: 'shopify', maxPages: 40 }, // Cloudflare 403 on the public feed
  // No legitimate channel at probe 2026-11-27: honest disabled record, no evasion attempts.
  { id: 'centrepoint', base: 'https://www.centrepointstores.com', kind: 'sitemap', maxPages: 0, disabled: 'no Egypt channel announced (robots lists AE/BH/SA/KW/QA/OM sitemapindexes only) and those answer 403 Cloudflare (probe 2026-11-27); we do not evade' },
  { id: 'noon', base: 'https://www.noon.com', kind: 'sitemap', maxPages: 0, disabled: 'robots and sitemap timed out on repeated polite probes (2026-11-27); no readable public channel; we do not evade' },
  { id: 'carrefour', base: 'https://www.carrefouregypt.com', kind: 'sitemap', maxPages: 0, disabled: 'every path answers an empty JS shell; no readable sitemap or feed (probe 2026-11-27)' },
  { id: 'elezaby', base: 'https://elezabypharmacy.com', kind: 'sitemap', maxPages: 0, disabled: 'server closed the connection on polite probes (2026-11-27); no channel reachable; we do not evade' },
  { id: 'breadfast', base: 'https://www.breadfast.com', kind: 'sitemap', maxPages: 0, disabled: 'app-first store; sitemap redirects home and no product feed exists (probe 2026-11-27)' },
  { id: 'maxab', base: 'https://www.maxab.io', kind: 'sitemap', maxPages: 0, disabled: 'B2B platform; no public product feed (probe 2026-11-27)' },
  { id: 'cartona', base: 'https://cartona.com', kind: 'sitemap', maxPages: 0, disabled: 'B2B; sitemap lists 3 info pages only, no product feed (probe 2026-11-27)' },
  { id: 'extra', base: 'https://www.extra.com.eg', kind: 'sitemap', maxPages: 0, disabled: 'domain/connection unconfirmed; timeouts on all channels (probe 2026-11-27)' },
  { id: 'virgin', base: 'https://www.virginmegastore.com.eg', kind: 'sitemap', maxPages: 0, disabled: 'domain unconfirmed; connection failures on all channels (probe 2026-11-27)' },
  { id: 'metro', base: 'https://www.metro-markets.com', kind: 'sitemap', maxPages: 0, disabled: 'no sitemap (404) and no feed (probe 2026-11-27)' },
  { id: 'seoudi', base: 'https://www.seoudi.com', kind: 'sitemap', maxPages: 0, disabled: 'no sitemap (404) and no feed (probe 2026-11-27)' },
  { id: 'oscar', base: 'https://www.oscarmarkets.com', kind: 'sitemap', maxPages: 0, disabled: 'no sitemap (404) and no feed (probe 2026-11-27)' },
  { id: 'misrpharmacies', base: 'https://www.misrpharmacies.com', kind: 'sitemap', maxPages: 0, disabled: 'no sitemap or feed (404); robots sets Crawl-Delay 20 if a channel appears (probe 2026-11-27)' },
  { id: 'yodawy', base: 'https://www.yodawy.com', kind: 'sitemap', maxPages: 0, disabled: 'no sitemap (404) and no feed (probe 2026-11-27)' },
  { id: 'namshi', base: 'https://www.namshi.com', kind: 'sitemap', maxPages: 0, disabled: 'all channels timed out or failed (probe 2026-11-27)' },
  { id: '6thstreet', base: 'https://www.6thstreet.com', kind: 'sitemap', maxPages: 0, disabled: 'announced sitemaps cover AE/BH/KW/OM/QA/SA only; no Egypt storefront channel (probe 2026-11-27)' },
  { id: 'nike', base: 'https://www.nike.com', kind: 'sitemap', maxPages: 0, disabled: 'PDP sitemap index has no Egypt file (probe 2026-11-27)' },
  { id: 'computershop', base: 'https://www.computershop.com.eg', kind: 'sitemap', maxPages: 0, disabled: 'timeouts on all channels (probe 2026-11-27)' },
  { id: 'doctorm', base: 'https://doctormpharmacy.com', kind: 'sitemap', maxPages: 0, disabled: 'Shopify store unavailable (402 Unavailable Shop) (probe 2026-11-27)' },
  { id: 'temu', base: 'https://www.temu.com', kind: 'sitemap', maxPages: 0, disabled: 'no sitemap (404) and no public feed (probe 2026-11-27)' },
  { id: 'aliexpress', base: 'https://www.aliexpress.com', kind: 'sitemap', maxPages: 0, disabled: 'sitemap redirects to a 404 page; no public feed (probe 2026-11-27)' },
  { id: 'dubizzle', base: 'https://www.dubizzle.com.eg', kind: 'sitemap', maxPages: 0, disabled: 'sitemap exists but classified ads, out of retail-price scope (probe 2026-11-27)' },
];
