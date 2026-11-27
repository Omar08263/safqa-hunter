// Observation gate: every item is schema-validated before it can reach the sink (and therefore D1).
// A failed observation is recorded as scrapeStatus 'failed' and never overwrites the last good value.
import { z } from 'zod';
import type { Item } from './extract/jsonld.ts';

export const itemSchema = z.object({
  url: z.string().url(),
  title: z.string().trim().min(1).max(500),
  brand: z.string().trim().min(1).max(120).nullable(),
  price: z.number().finite().positive(),
  listPrice: z.number().finite().positive().nullable(),
  currency: z.literal('EGP'),
  inStock: z.boolean(),
  image: z.string().url().nullable(),
  gtin: z.string().regex(/^\d{8,14}$/).nullable(),
  mpn: z.string().trim().min(1).max(80).nullable(),
  crumbs: z.array(z.string().max(120)).max(12),
}).refine((it) => it.listPrice == null || it.listPrice >= it.price, { message: 'listPrice below price' });

export type ItemCheck = { ok: true; item: Item } | { ok: false; issues: string[] };

/** A non-URL image (e.g. the literal "undefined" from a url-less ImageObject) is dropped to null —
 *  like a junk GTIN — instead of failing the whole observation at the schema gate. */
const validImage = (raw: string | null | undefined): string | null => {
  const s = raw?.trim();
  if (!s || s === 'undefined' || s === 'null') return null;
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch { return null; }
};

/** Normalise then validate: trims strings, drops a non-numeric GTIN, coerces empty optionals to null. */
export function checkItem(raw: Item): ItemCheck {
  const item: Item = {
    ...raw,
    title: raw.title?.trim() ?? '',
    brand: raw.brand?.trim() || null,
    currency: (raw.currency || 'EGP').toUpperCase(),
    gtin: raw.gtin && /^\d{8,14}$/.test(raw.gtin.replace(/\D/g, '')) ? raw.gtin.replace(/\D/g, '') : null,
    mpn: raw.mpn?.trim() || null,
    image: validImage(raw.image),
    listPrice: raw.listPrice && raw.price && raw.listPrice > raw.price ? raw.listPrice : null,
    crumbs: (raw.crumbs ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 12),
  };
  const r = itemSchema.safeParse(item);
  return r.success ? { ok: true, item: r.data as Item } : { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}
