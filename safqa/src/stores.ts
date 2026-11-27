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
];
