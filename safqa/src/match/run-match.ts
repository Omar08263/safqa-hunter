// Cross-store matching over hunt output (additive CLI path; the hunt pipeline
// itself is untouched). Reads dry-hunt JSONL files (out/<store>.jsonl), embeds
// titles with the chosen model, runs the matcher, and writes:
//   out/matches.jsonl  — accepted + grey pairs with scores/decisions
//   out/clusters.json  — conservative same-product clusters (urls)
//   out/vecindex.db    — int8 vector index (actions/cache carries it between runs)
// No server writes here: posting embeddings/matches to the Worker sink is a
// separate, explicitly-gated step (site-side endpoint registration is Omar's call).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchProducts, type Embedder, type PairResult } from './matcher.ts';
import type { ProductLike } from './normalize.ts';
import { DIM, VecIndex } from './vecindex.ts';

/** Deterministic lexical embedder (same floor as scripts/eval-pairs.ts) for offline runs/tests. */
export const fakeEmbedder: Embedder = async (texts) => texts.map((t) => {
  const v = new Float32Array(DIM);
  for (const tok of t.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!tok) continue;
    let h = 0;
    for (const ch of tok) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIM]! += 1;
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
});

interface RawItem {
  url?: string;
  title?: string;
  brand?: string | null;
  gtin?: string | null;
  mpn?: string | null;
  crumbs?: string[];
}

/** Read every out/<store>.jsonl (except our own matches output) into ProductLike rows. */
export function readProducts(dir: string): ProductLike[] {
  if (!existsSync(dir)) return [];
  const out: ProductLike[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.jsonl') || f === 'matches.jsonl') continue;
    const store = f.replace(/\.jsonl$/, '');
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let it: RawItem;
      try { it = JSON.parse(line) as RawItem; } catch { continue; }
      if (!it.title || !it.url) continue;
      out.push({ url: it.url, title: it.title, brand: it.brand ?? null, gtin: it.gtin ?? null, mpn: it.mpn ?? null, crumbs: it.crumbs ?? [], store });
    }
  }
  return out;
}

export interface RunMatchResult {
  products: number;
  pairs: PairResult[];
  clusters: string[][];
  stats: Record<string, number>;
  vecIndexed: number;
}

export async function runMatch(opts: {
  dir: string;
  outDir?: string;
  embed: Embedder;
  vecPath?: string;
}): Promise<RunMatchResult> {
  const outDir = opts.outDir ?? opts.dir;
  mkdirSync(outDir, { recursive: true });
  const products = readProducts(opts.dir);
  const { pairs, clusters, stats } = await matchProducts(products, opts.embed);
  const kept = pairs.filter((p) => p.decision !== 'different');
  writeFileSync(join(outDir, 'matches.jsonl'), kept.map((p) => JSON.stringify(p)).join('\n') + (kept.length ? '\n' : ''));
  writeFileSync(join(outDir, 'clusters.json'), JSON.stringify(clusters, null, 2));

  // Vector index for future incremental matching (only when dims fit the index).
  let vecIndexed = 0;
  if (opts.vecPath && products.length) {
    const vecs = await opts.embed(products.map((p) => p.title));
    if (vecs[0] && vecs[0].length === DIM) {
      const idx = await VecIndex.open(opts.vecPath);
      try {
        products.forEach((p, i) => idx.upsert(p.url, vecs[i]!));
        vecIndexed = idx.count();
      } finally {
        idx.close();
      }
    }
  }
  return { products: products.length, pairs: kept, clusters, stats, vecIndexed };
}
