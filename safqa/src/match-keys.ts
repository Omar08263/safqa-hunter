// Hierarchical identity keys, tried in strict order before any fuzzy matching:
// GTIN → MPN → ASIN → brand+title+size. The existing matchKey (shared with the Worker)
// stays untouched; this module adds the ASIN tier, an explicit size tier, and a
// three-zone fuzzball decision (≥92 same / 80–92 grey / <80 different) that stores confidence.
import { ratio } from 'fuzzball';
import { guessBrand, matchKey, normAr, parseSpecs } from './safqa-core.ts';

export interface IdentityInput {
  title: string;
  brand?: string | null;
  gtin?: string | null;
  mpn?: string | null;
  asin?: string | null;
  url?: string | null;
}

export type KeyTier = 'gtin' | 'mpn' | 'asin' | 'brand-title-size' | 'matchkey';
export interface IdentityKey { key: string; tier: KeyTier; confidence: number }

const ASIN_RE = /\bB[0-9A-Z]{9}\b/i;

/** ASIN from an explicit field, a title token, or an Amazon-style URL (/dp/B0…, /gp/product/B0…). */
export function extractAsin(o: { asin?: string | null; title?: string; url?: string | null }): string | null {
  const direct = (o.asin ?? '').trim().toUpperCase();
  if (/^B[0-9A-Z]{9}$/.test(direct)) return direct;
  const fromUrl = o.url?.match(/\/(?:dp|gp\/product|product)\/([B][0-9A-Z]{9})/i)?.[1];
  if (fromUrl) return fromUrl.toUpperCase();
  const fromTitle = o.title?.match(ASIN_RE)?.[0];
  return fromTitle ? fromTitle.toUpperCase() : null;
}

/** Size signature: storage/RAM/inches from the title — variants must never merge. */
export function sizeSignature(title: string): string {
  const s = parseSpecs(title);
  return [s.storageGb ?? '', s.ramGb ?? '', s.inches ?? ''].join(':');
}

/** The strongest identity key available for a product, with the tier that produced it. */
export function identityKey(o: IdentityInput): IdentityKey {
  const gtin = (o.gtin ?? '').replace(/\D/g, '');
  if (gtin.length >= 8 && !/^0+$/.test(gtin)) return { key: `g:${gtin.padStart(14, '0')}`, tier: 'gtin', confidence: 1 };
  const brand = guessBrand(o.title, o.brand) ?? 'x';
  const mpn = normAr(o.mpn ?? '').replace(/\s/g, '');
  if (mpn.length >= 5 && /\d/.test(mpn) && /[a-z]/.test(mpn)) return { key: `m:${brand}:${mpn}`, tier: 'mpn', confidence: 0.98 };
  const asin = extractAsin(o);
  if (asin) return { key: `a:${asin}`, tier: 'asin', confidence: 0.97 };
  const size = sizeSignature(o.title);
  if (size !== '::') {
    const toks = parseSpecs(o.title).tokens.filter((w) => w !== brand).slice(0, 6).sort().join('-');
    if (toks) return { key: `s:${brand}:${toks}:${size}`, tier: 'brand-title-size', confidence: 0.9 };
  }
  return { key: matchKey({ title: o.title, brand: o.brand, gtin: o.gtin, mpn: o.mpn }), tier: 'matchkey', confidence: 0.8 };
}

export type FuzzyZone = 'same' | 'grey' | 'different';
export interface FuzzyDecision { score: number; zone: FuzzyZone; confidence: number }

/** Three-zone title similarity. Grey (80–92) is for rerank/manual review — never auto-merged. */
export function fuzzyDecision(a: string, b: string): FuzzyDecision {
  const score = ratio(normAr(a), normAr(b));
  const zone: FuzzyZone = score >= 92 ? 'same' : score >= 80 ? 'grey' : 'different';
  return { score, zone, confidence: Math.round(score) / 100 };
}

/**
 * Decide whether two products are the same: exact identity tiers first (GTIN/MPN/ASIN/size-key),
 * fuzzball only when no tier decides. A size conflict (both state storage/RAM/inches, different)
 * vetoes a fuzzy 'same'.
 */
export function decideSame(a: IdentityInput, b: IdentityInput): { same: boolean; zone: FuzzyZone; method: KeyTier | 'fuzzy' | 'size-conflict'; confidence: number } {
  const ka = identityKey(a), kb = identityKey(b);
  if (ka.key === kb.key) return { same: true, zone: 'same', method: ka.tier, confidence: Math.min(ka.confidence, kb.confidence) };
  if (ka.tier === kb.tier && (ka.tier === 'gtin' || ka.tier === 'mpn' || ka.tier === 'asin')) {
    return { same: false, zone: 'different', method: ka.tier, confidence: 0.99 }; // both carry a strong id, ids differ
  }
  const sa = parseSpecs(a.title), sb = parseSpecs(b.title);
  const conflict = (x?: number, y?: number) => x != null && y != null && x !== y;
  if (conflict(sa.storageGb, sb.storageGb) || conflict(sa.ramGb, sb.ramGb) || conflict(sa.inches, sb.inches)) {
    return { same: false, zone: 'different', method: 'size-conflict', confidence: 0.95 };
  }
  const f = fuzzyDecision(a.title, b.title);
  return { same: f.zone === 'same', zone: f.zone, method: 'fuzzy', confidence: f.confidence };
}
