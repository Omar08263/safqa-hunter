// Structured-data extractor (the extruct idea, in TS): schema.org Product in JSON-LD (incl. @graph,
// ProductGroup/hasVariant, Offer/AggregateOffer), then OpenGraph product meta. Returns the store's own data only.
import { load } from 'cheerio';

export interface Item { url: string; title: string; brand: string | null; price: number | null; listPrice: number | null; currency: string; inStock: boolean; image: string | null; gtin: string | null; mpn: string | null; crumbs: string[] }

const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
function flat(x: any): any[] { if (!x) return []; if (Array.isArray(x)) return x.flatMap(flat); if (x['@graph']) return flat(x['@graph']); return [x, ...(x.hasVariant ? flat(x.hasVariant) : [])]; }
const isType = (o: any, t: string) => [].concat(o?.['@type'] ?? []).some((x: string) => String(x).toLowerCase() === t.toLowerCase());

export function extract(html: string, url: string): { item: Item | null; candidates: { cls: string; text: string }[] } {
  const $ = load(html);
  const nodes: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => { try { nodes.push(...flat(JSON.parse($(el).text().trim()))); } catch { /* skip broken block */ } });
  const crumbs = nodes.filter((n) => isType(n, 'BreadcrumbList')).flatMap((b) => (b.itemListElement ?? []).map((e: any) => String(e.name ?? e.item?.name ?? ''))).filter(Boolean).slice(1, -1);
  const prod = nodes.find((n) => isType(n, 'Product') && n.offers) ?? nodes.find((n) => isType(n, 'Product'));
  const meta = (p: string) => $(`meta[property="${p}"],meta[name="${p}"]`).attr('content') ?? null;
  let item: Item | null = null;
  if (prod) {
    const offers = flat(prod.offers);
    const o = offers.find((x) => num(x.price ?? x.lowPrice)) ?? offers[0] ?? {};
    const price = num(o.price ?? o.lowPrice);
    const list = num(o.priceSpecification?.price && o.priceSpecification?.priceType?.includes?.('ListPrice') ? o.priceSpecification.price : o.highPrice);
    item = {
      url, title: String(prod.name ?? meta('og:title') ?? '').trim(), brand: typeof prod.brand === 'string' ? prod.brand : prod.brand?.name ?? null,
      price, listPrice: list && price && list > price ? list : null, currency: String(o.priceCurrency ?? 'EGP'),
      inStock: !/OutOfStock|SoldOut|Discontinued/i.test(String(o.availability ?? '')), image: [].concat(prod.image ?? [])[0] ? String(typeof [].concat(prod.image)[0] === 'object' ? ([].concat(prod.image)[0] as any).url : [].concat(prod.image)[0]) : meta('og:image'),
      gtin: String(prod.gtin13 ?? prod.gtin ?? prod.gtin12 ?? prod.gtin14 ?? prod.gtin8 ?? '') || null, mpn: String(prod.mpn ?? '') || null, crumbs, // sku is store-internal: never used for cross-store matching
    };
  } else if (meta('product:price:amount') || meta('og:price:amount')) {
    item = { url, title: meta('og:title') ?? $('title').text().trim(), brand: meta('product:brand'), price: num(meta('product:price:amount') ?? meta('og:price:amount')), listPrice: null, currency: meta('product:price:currency') ?? 'EGP', inStock: !/oos|out of stock/i.test(meta('product:availability') ?? ''), image: meta('og:image'), gtin: null, mpn: null, crumbs };
  }
  // Price-like text candidates for the AI self-healing fallback (only used when structured data has no price).
  const candidates: { cls: string; text: string }[] = [];
  if (!item?.price) $('[class*="price" i],[id*="price" i],[itemprop="price"]').slice(0, 30).each((_, el) => { const t = $(el).text().replace(/\s+/g, ' ').trim(); if (/\d/.test(t) && t.length < 80) candidates.push({ cls: ($(el).attr('class') ?? $(el).attr('id') ?? 'itemprop').slice(0, 100), text: t }); });
  return { item, candidates };
}
