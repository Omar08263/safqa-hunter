// Arabic/English title normalisation + spec extraction for cross-store matching.
// Builds on safqa-core (identical keys to the Worker) and adds what the embedding
// matcher needs: model-code extraction, capacity extraction and hard-conflict fields.
import { guessBrand, normAr, parseSpecs, searchText } from '../safqa-core.ts';

export interface ProductLike {
  url: string;
  title: string;
  brand?: string | null;
  gtin?: string | null;
  mpn?: string | null;
  crumbs?: string[];
  store?: string;
}

/** Generic alphanumeric tokens that look like model codes but are specs/marketing. */
const GENERIC_CODES = new Set([
  '1000W', '1500W', '2000W', '1200W', '800W', '600W', '500W', '400W', '300W', '250W', '200W', '100W', '65W', '45W', '25W', '20W', '15W', '12W', '10W', '5W',
  '1080P', '720P', '2160P', '1440P', '4K', '8K', 'HDR10', 'HDR10PLUS', '144HZ', '120HZ', '165HZ', '240HZ', '75HZ', '60HZ',
  'AC1200', 'AC750', 'AC1900', 'AX1800', 'AX3000', 'AX5400', 'WIFI6', 'WIFI5', 'USB3', 'USB2', 'TYPEC', 'HDMI', 'DDR4', 'DDR5', 'DDR3',
  '512GB', '256GB', '128GB', '64GB', '32GB', '16GB', '8GB', '4GB', '2GB', '1TB', '2TB', '500GB', '240GB', '120GB', '480GB', '960GB', '250GB',
  '1920X1080', '1366X768', 'FHD', 'UHD', 'QHD', 'WUXGA', 'LED', 'OLED', 'QLED', 'IPS', 'VA', 'TN', 'AMOLED', 'LTE', '5G', '4G', '3G', 'GPS', 'NFC',
  '5000MAH', '4000MAH', '6000MAH', '3000MAH', '2000MAH', '10000MAH', '20000MAH', 'IP67', 'IP68', 'IP65', 'IP54', 'IPX4', 'IPX7',
  '220V', '240V', '110V', '12V', '24V', '50HZ', '60HZ', 'SATA', 'NVME', 'PCIE', 'GEN3', 'GEN4', 'GEN5', 'M2', '2280', '2242',
]);

/** Model codes: alphanumeric tokens (≥4 chars, letter+digit) that are not generic specs.
 *  The brand's own name (e.g. INSTA360) is never a model code. */
export function modelCodes(title: string, brand?: string | null): string[] {
  const brandCode = (brand ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const found = new Set<string>();
  for (const m of title.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*/g)) {
    const raw = m[0];
    const code = raw.toUpperCase().replace(/[-/]/g, '');
    if (code.length < 4) continue;
    if (brandCode && code === brandCode) continue;
    if (!/\d/.test(code) || !/[A-Z]/.test(code)) continue;
    if (GENERIC_CODES.has(code)) continue;
    if (/^\d+(GB|TB|MB|MAH|W|HZ|V|MM|CM|KG|ML|L)$/.test(code)) continue;
    found.add(code);
  }
  return [...found];
}

export interface Capacities {
  storageGb?: number;
  ramGb?: number;
  inches?: number;
  liters?: number;
  kg?: number;
  watts?: number;
  ml?: number;
}

/** Capacities that make two listings different products when both are known and differ. */
export function capacities(title: string): Capacities {
  const s = parseSpecs(title);
  const t = ` ${searchText(title)} `;
  const out: Capacities = {};
  if (s.storageGb) out.storageGb = s.storageGb;
  if (s.ramGb) out.ramGb = s.ramGb;
  if (s.inches) out.inches = s.inches;
  const lit = t.match(/(\d+(?:\.\d+)?)\s*(?:liter|litre|l\b|لتر)/);
  if (lit) out.liters = Number(lit[1]);
  const kg = t.match(/(\d+(?:\.\d+)?)\s*(?:kg|كيلو|كجم)/);
  if (kg) out.kg = Number(kg[1]);
  const w = t.match(/(\d{3,4})\s*(?:watt|w\b|وات)/);
  if (w) out.watts = Number(w[1]);
  const ml = t.match(/(\d{3,4})\s*(?:ml|مل)/);
  if (ml) out.ml = Number(ml[1]);
  return out;
}

export interface NormalizedProduct {
  url: string;
  store: string;
  title: string;
  /** Text fed to the embedding model: original title (models are multilingual). */
  embedText: string;
  /** searchText() form used for lexical blocking. */
  lexText: string;
  brand: string | null;
  gtin: string | null;
  codes: string[];
  caps: Capacities;
  category: string | null;
  crumbs: string[];
}

export function normalizeProduct(p: ProductLike, categorizeFn: (t: string, c?: string[]) => string | null): NormalizedProduct {
  const gtin = (p.gtin ?? '').replace(/\D/g, '');
  const brand = guessBrand(p.title, p.brand);
  return {
    url: p.url,
    store: p.store ?? '',
    title: p.title,
    embedText: p.title.replace(/[\u200e\u200f\u2066-\u2069]/g, '').trim(),
    lexText: searchText(p.title),
    brand,
    gtin: gtin.length >= 8 && !/^0+$/.test(gtin) ? gtin.padStart(14, '0') : null,
    codes: modelCodes(p.title, brand),
    caps: capacities(p.title),
    category: categorizeFn(p.title, p.crumbs ?? []),
    crumbs: p.crumbs ?? [],
  };
}

export { normAr };
