// Builds the labeled pair set (data/pairs.jsonl) from real dry-hunt outputs.
// Usage: npx tsx scripts/build-pairs.ts <dir-with-store-jsonl-files> [...]
// Each input dir holds <store>.jsonl files (Sink dry mode / hunt artifacts).
//
// Labeling methodology (documented in data/pairs-README.md):
//  SAME  — same GTIN across stores, or same rare model code + same brand across
//          stores, or identical safqa-core matchKey across stores with a shared
//          rare token. (Real Safqa data currently carries no GTIN at all.)
//  DIFF  — hard negatives: same brand + shared line words but different rare
//          model codes, or same line with different stated capacities.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { categorize, guessBrand, matchKey, parseSpecs } from '../src/safqa-core.ts';
import { capacities, modelCodes, type ProductLike } from '../src/match/normalize.ts';

interface Row extends ProductLike { store: string; price?: number | null }

const dirs = process.argv.slice(2);
if (!dirs.length) { console.error('usage: build-pairs.ts <dir> [...]'); process.exit(2); }

const byUrl = new Map<string, Row>();
for (const dir of dirs) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const store = basename(f, '.jsonl');
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as Row;
      if (r.url && r.title) byUrl.set(r.url, { ...r, store });
    }
  }
}
const rows = [...byUrl.values()];
console.log(`products: ${rows.length} from ${new Set(rows.map((r) => r.store)).size} stores`);

const brandOf = (r: Row) => guessBrand(r.title, r.brand);
const codesOf = new Map(rows.map((r) => [r.url, modelCodes(r.title, guessBrand(r.title, r.brand))]));
const codeCount = new Map<string, number>();
for (const r of rows) for (const c of codesOf.get(r.url)!) codeCount.set(c, (codeCount.get(c) ?? 0) + 1);
const rare = (c: string) => (codeCount.get(c) ?? 0) <= 8;

interface Pair { label: 'same' | 'different'; method: string; a: Row; b: Row; note?: string }
const pairs: Pair[] = [];
const pairSeen = new Set<string>();
const addPair = (label: Pair['label'], method: string, a: Row, b: Row, note?: string) => {
  if (a.url === b.url || a.store === b.store) return;
  const key = [a.url, b.url].sort().join('|');
  if (pairSeen.has(key)) return;
  pairSeen.add(key);
  pairs.push({ label, method, a, b, note });
};

// SAME 1: identical GTIN across stores.
const byGtin = new Map<string, Row[]>();
for (const r of rows) { const g = (r.gtin ?? '').replace(/\D/g, ''); if (g.length >= 8) { const arr = byGtin.get(g) ?? []; arr.push(r); byGtin.set(g, arr); } }
for (const arr of byGtin.values()) for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) addPair('same', 'gtin', arr[i]!, arr[j]!);

// SAME 2: same rare model code + same brand across stores.
const byCode = new Map<string, Row[]>();
for (const r of rows) for (const c of codesOf.get(r.url)!) if (rare(c)) { const arr = byCode.get(c) ?? []; arr.push(r); byCode.set(c, arr); }
for (const [code, arr] of byCode) {
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const a = arr[i]!, b = arr[j]!;
    if (brandOf(a) && brandOf(a) === brandOf(b)) addPair('same', 'model-code', a, b, code);
  }
}

// SAME 3: identical matchKey across stores (brand+model tokens+capacities), shared rare token required.
const byKey = new Map<string, Row[]>();
for (const r of rows) { const k = matchKey({ title: r.title, brand: r.brand, gtin: r.gtin, mpn: r.mpn }); const arr = byKey.get(k) ?? []; arr.push(r); byKey.set(k, arr); }
for (const arr of byKey.values()) {
  if (arr.length < 2 || arr.length > 12) continue;
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const a = arr[i]!, b = arr[j]!;
    const shared = codesOf.get(a.url)!.filter((c) => codesOf.get(b.url)!.includes(c));
    const toksA = new Set(parseSpecs(a.title).tokens), toksB = new Set(parseSpecs(b.title).tokens);
    const overlap = [...toksA].filter((t) => toksB.has(t) && /\d/.test(t)).length;
    if (shared.length || overlap >= 1) addPair('same', 'matchkey', a, b);
  }
}

// DIFF 1: same brand, different rare model codes, titles share >=2 non-brand tokens.
const byBrand = new Map<string, Row[]>();
for (const r of rows) { const b = brandOf(r); if (b) { const arr = byBrand.get(b) ?? []; arr.push(r); byBrand.set(b, arr); } }
let diffCode = 0;
for (const arr of byBrand.values()) {
  if (diffCode > 400) break;
  for (let i = 0; i < arr.length && diffCode <= 400; i++) for (let j = i + 1; j < arr.length; j++) {
    const a = arr[i]!, b = arr[j]!;
    if (a.store === b.store) continue;
    const ca = codesOf.get(a.url)!.filter(rare), cb = codesOf.get(b.url)!.filter(rare);
    if (!ca.length || !cb.length || ca.some((c) => cb.includes(c))) continue;
    const ta = new Set(parseSpecs(a.title).tokens), tb = new Set(parseSpecs(b.title).tokens);
    const shared = [...ta].filter((t) => tb.has(t)).length;
    if (shared >= 2) { addPair('different', 'diff-model-code', a, b); diffCode++; }
  }
}

// DIFF 2: same brand + same line words, different stated capacity.
let diffCap = 0;
for (const arr of byBrand.values()) {
  if (diffCap > 200) break;
  for (let i = 0; i < arr.length && diffCap <= 200; i++) for (let j = i + 1; j < arr.length; j++) {
    const a = arr[i]!, b = arr[j]!;
    if (a.store === b.store) continue;
    const ka = capacities(a.title), kb = capacities(b.title);
    const conflict = (['storageGb', 'liters', 'kg', 'watts', 'ml'] as const).some((k) => ka[k] != null && kb[k] != null && ka[k] !== kb[k]);
    if (!conflict) continue;
    const ta = new Set(parseSpecs(a.title).tokens), tb = new Set(parseSpecs(b.title).tokens);
    if ([...ta].filter((t) => tb.has(t)).length >= 2) { addPair('different', 'diff-capacity', a, b); diffCap++; }
  }
}

const slim = (r: Row) => ({ url: r.url, store: r.store, title: r.title, brand: r.brand ?? null, gtin: r.gtin ?? null, mpn: r.mpn ?? null, crumbs: r.crumbs ?? [], category: categorize(r.title, r.crumbs ?? []) });
const out = pairs.map((p) => JSON.stringify({ label: p.label, method: p.method, note: p.note ?? null, a: slim(p.a), b: slim(p.b) })).join('\n') + '\n';
writeFileSync('data/pairs.jsonl', out);
const byMethod = new Map<string, number>();
for (const p of pairs) byMethod.set(`${p.label}:${p.method}`, (byMethod.get(`${p.label}:${p.method}`) ?? 0) + 1);
console.log([...byMethod].map(([k, v]) => `${k}=${v}`).join(' '));
console.log(`total pairs: ${pairs.length} (same=${pairs.filter((p) => p.label === 'same').length}, different=${pairs.filter((p) => p.label === 'different').length})`);
