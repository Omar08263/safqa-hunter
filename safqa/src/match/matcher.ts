// Cross-store product matcher: GTIN → blocking (brand/category/rare-token) →
// embedding cosine inside blocks → hard-conflict vetoes → three-zone decision →
// conservative clustering. Pure logic: the embedder is injected, so unit tests
// run with a deterministic fake and production runs transformers.js.
import { categorize, matchKey } from '../safqa-core.ts';
import { normalizeProduct, type NormalizedProduct, type ProductLike } from './normalize.ts';

export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Hard conflicts: when both sides state a capacity/model and they differ, never merge. */
export function hardConflict(a: NormalizedProduct, b: NormalizedProduct): string | null {
  if (a.brand && b.brand && a.brand !== b.brand) return 'brand';
  for (const k of ['storageGb', 'ramGb', 'liters', 'kg', 'watts', 'ml'] as const) {
    const x = a.caps[k], y = b.caps[k];
    if (x != null && y != null && x !== y) return k;
  }
  if (a.caps.inches != null && b.caps.inches != null && Math.abs(a.caps.inches - b.caps.inches) > 0.6) return 'inches';
  // Different rare model codes on both sides = different models, however similar the titles.
  if (a.codes.length && b.codes.length && !a.codes.some((c) => b.codes.includes(c))) return 'model-code';
  return null;
}

export interface MatchOptions {
  /** cosine >= accept → same product. */
  accept?: number;
  /** cosine < reject → different. Between reject and accept → grey (rerank/manual). */
  reject?: number;
  /** Max grey-zone pairs returned for a reranker, per run. */
  greyCap?: number;
}

export type Decision = 'same' | 'different' | 'grey';

export interface PairResult {
  a: NormalizedProduct;
  b: NormalizedProduct;
  score: number;
  decision: Decision;
  method: 'gtin' | 'matchkey' | 'embedding' | 'conflict';
  conflict?: string;
}

/** Blocking keys: brand+category, brand+rare code, GTIN. A pair is compared if it shares any key. */
export function blockKeys(p: NormalizedProduct, rareCodes: Set<string>): string[] {
  const keys: string[] = [];
  if (p.gtin) keys.push(`g:${p.gtin}`);
  const brand = p.brand ?? 'x';
  keys.push(`bc:${brand}:${p.category ?? 'x'}`);
  for (const c of p.codes) if (rareCodes.has(c)) keys.push(`code:${c}`);
  return keys;
}

export async function matchProducts(
  products: ProductLike[],
  embed: Embedder,
  opts: MatchOptions = {},
): Promise<{ pairs: PairResult[]; clusters: string[][]; stats: Record<string, number> }> {
  const accept = opts.accept ?? 0.82;
  const reject = opts.reject ?? 0.55;
  const greyCap = opts.greyCap ?? 500;
  const norm = products.map((p) => normalizeProduct(p, categorize));

  // A code is "rare" (identifying) when it appears on at most 8 listings.
  const codeCount = new Map<string, number>();
  for (const p of norm) for (const c of p.codes) codeCount.set(c, (codeCount.get(c) ?? 0) + 1);
  const rareCodes = new Set([...codeCount].filter(([, n]) => n <= 8).map(([c]) => c));

  const blocks = new Map<string, number[]>();
  norm.forEach((p, i) => { for (const k of blockKeys(p, rareCodes)) { const arr = blocks.get(k) ?? []; arr.push(i); blocks.set(k, arr); } });

  const seen = new Set<string>();
  const candidateIdx: [number, number][] = [];
  for (const idxs of blocks.values()) {
    if (idxs.length > 400) continue; // degenerate block: skip rather than explode
    for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) {
      const key = `${idxs[i]}:${idxs[j]}`;
      if (!seen.has(key)) { seen.add(key); candidateIdx.push([idxs[i]!, idxs[j]!]); }
    }
  }

  const pairs: PairResult[] = [];
  const needsEmbed: [number, number][] = [];
  for (const [i, j] of candidateIdx) {
    const a = norm[i]!, b = norm[j]!;
    if (a.url === b.url) continue;
    if (a.gtin && b.gtin) {
      pairs.push({ a, b, score: a.gtin === b.gtin ? 1 : 0, decision: a.gtin === b.gtin ? 'same' : 'different', method: 'gtin' });
      continue;
    }
    const conflict = hardConflict(a, b);
    if (conflict) { pairs.push({ a, b, score: 0, decision: 'different', method: 'conflict', conflict }); continue; }
    // Strong key: a shared rare model code with the same brand and no hard conflict
    // is the same product (this is also how the labeled pair set defines SAME).
    if (a.brand && a.brand === b.brand && a.codes.some((c) => rareCodes.has(c) && b.codes.includes(c))) {
      pairs.push({ a, b, score: 1, decision: 'same', method: 'matchkey' });
      continue;
    }
    if (matchKey({ title: a.title, brand: a.brand }) === matchKey({ title: b.title, brand: b.brand })) {
      pairs.push({ a, b, score: 1, decision: 'same', method: 'matchkey' });
      continue;
    }
    needsEmbed.push([i, j]);
  }

  if (needsEmbed.length) {
    const involved = [...new Set(needsEmbed.flat())];
    const vecs = await embed(involved.map((i) => norm[i]!.embedText));
    const vecOf = new Map(involved.map((idx, k) => [idx, vecs[k]!]));
    for (const [i, j] of needsEmbed) {
      const score = cosine(vecOf.get(i)!, vecOf.get(j)!);
      const decision: Decision = score >= accept ? 'same' : score < reject ? 'different' : 'grey';
      pairs.push({ a: norm[i]!, b: norm[j]!, score, decision, method: 'embedding' });
    }
  }

  // Conservative clustering: union-find over 'same' pairs, but a merge is refused
  // when it would join two clusters that contain a hard-conflicting pair.
  const parent = norm.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const members = new Map<number, number[]>();
  const rebuild = () => { members.clear(); norm.forEach((_, i) => { const r = find(i); const arr = members.get(r) ?? []; arr.push(i); members.set(r, arr); }); };
  rebuild();
  let refusedMerges = 0;
  for (const p of pairs.filter((x) => x.decision === 'same').sort((x, y) => y.score - x.score)) {
    const ia = norm.indexOf(p.a), ib = norm.indexOf(p.b);
    const ra = find(ia), rb = find(ib);
    if (ra === rb) continue;
    const clash = (members.get(ra) ?? []).some((x) => (members.get(rb) ?? []).some((y) => hardConflict(norm[x]!, norm[y]!)));
    if (clash) { refusedMerges++; continue; }
    parent[rb] = ra;
    rebuild();
  }
  const clusters = [...members.values()].filter((m) => m.length > 1).map((m) => m.map((i) => norm[i]!.url));

  const grey = pairs.filter((p) => p.decision === 'grey');
  return {
    pairs,
    clusters,
    stats: {
      products: norm.length, candidates: candidateIdx.length, embedded: needsEmbed.length,
      same: pairs.filter((p) => p.decision === 'same').length,
      different: pairs.filter((p) => p.decision === 'different').length,
      grey: grey.length, greyOverCap: Math.max(0, grey.length - greyCap),
      clusters: clusters.length, refusedMerges,
    },
  };
}
