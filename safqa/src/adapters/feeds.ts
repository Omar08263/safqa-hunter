// Official public catalogue feeds. Shopify storefronts publish /products.json; WooCommerce publishes the
// Store API (/wp-json/wc/store/v1/products). Both are the store's own public data.
import type { Item } from '../extract/jsonld.ts';
import { politeFetch } from '../http.ts';

export async function* shopify(base: string, maxPages = 40): AsyncGenerator<Item> {
  for (let page = 1; page <= maxPages; page++) {
    const r = await politeFetch(`${base}/products.json?limit=250&page=${page}`, { accept: 'application/json' });
    if (r.status !== 200) throw Object.assign(new Error(`shopify HTTP ${r.status}`), { status: r.status });
    const j = JSON.parse(await r.text()) as { products: any[] };
    if (!j.products?.length) return;
    for (const p of j.products) {
      const v = (p.variants ?? []).find((x: any) => x.available) ?? p.variants?.[0];
      if (!v) continue;
      yield { url: `${base}/products/${p.handle}`, title: p.title, brand: p.vendor || null, price: Number(v.price), listPrice: Number(v.compare_at_price) || null, currency: 'EGP', inStock: Boolean(v.available), image: p.images?.[0]?.src ?? null, gtin: v.barcode || null, mpn: null, crumbs: p.product_type ? [p.product_type] : [] };
    }
  }
}
export async function* woocommerce(base: string, maxPages = 40): AsyncGenerator<Item> {
  for (let page = 1; page <= maxPages; page++) {
    const r = await politeFetch(`${base}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { accept: 'application/json' });
    if (r.status !== 200) throw Object.assign(new Error(`woocommerce HTTP ${r.status}`), { status: r.status });
    const arr = JSON.parse(await r.text()) as any[];
    if (!arr.length) return;
    for (const p of arr) {
      const minor = Number(p.prices?.currency_minor_unit ?? 2);
      const price = Number(p.prices?.price) / 10 ** minor; const reg = Number(p.prices?.regular_price) / 10 ** minor;
      yield { url: p.permalink, title: p.name, brand: null, price, listPrice: reg > price ? reg : null, currency: p.prices?.currency_code ?? 'EGP', inStock: Boolean(p.is_in_stock), image: p.images?.[0]?.src ?? null, gtin: null, mpn: null, crumbs: (p.categories ?? []).map((c: any) => c.name) };
    }
  }
}
