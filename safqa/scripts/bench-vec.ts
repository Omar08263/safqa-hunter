// Measures the local vector index (src/match/vecindex.ts) at Safqa scale:
// build time, file size, top-10 search latency, for sqlite-vec vec0 (when the
// extension loads) vs the plain-table brute-force fallback. Vectors come from
// the deterministic fake embedder — index mechanics do not depend on model
// quality, and this keeps the bench runnable without model downloads.
// Usage: npx tsx scripts/bench-vec.ts [nProducts]
import { readFileSync, rmSync, statSync } from 'node:fs';
import { VecIndex, quantizeInt8 } from '../src/match/vecindex.ts';
import type { Embedder } from '../src/match/matcher.ts';

const fake: Embedder = async (texts) => texts.map((t) => {
  const v = new Float32Array(384);
  for (const tok of t.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!tok) continue;
    let h = 0;
    for (const ch of tok) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 384]! += 1;
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
});

const labeled = readFileSync(new URL('../data/pairs.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const titles = [...new Set(labeled.flatMap((p: { a: { title: string }; b: { title: string } }) => [p.a.title, p.b.title]))];
const N = Number(process.argv[2]) || 10000;
// Tile real titles to reach N (suffix keeps keys unique; vectors stay realistic).
const items = Array.from({ length: N }, (_, i) => ({ key: `p${i}`, title: titles[i % titles.length]! }));
const vecs = await fake(items.map((x) => x.title));

const path = '/tmp/safqa-vec-bench.sqlite';
rmSync(path, { force: true });
const idx = await VecIndex.open(path);
console.log(`backend=${idx.usesVec0 ? 'sqlite-vec vec0 (int8)' : 'plain table + brute-force cosine (int8)'}`);
const t0 = Date.now();
items.forEach((x, i) => idx.upsert(x.key, vecs[i]!));
const buildMs = Date.now() - t0;
const size = statSync(path).size;
console.log(`n=${idx.count()} build=${buildMs}ms file=${(size / 1048576).toFixed(2)}MB (${(size / N).toFixed(0)}B/vector incl. overhead)`);

const queries = vecs.slice(0, 50);
const t1 = Date.now();
for (const q of queries) idx.search(q, 10);
const searchMs = (Date.now() - t1) / queries.length;
console.log(`top10 search avg=${searchMs.toFixed(2)}ms over ${queries.length} queries at n=${N}`);

// int8 quantisation fidelity: cosine(original, dequantised) should stay ~1.
let worst = 1;
for (let i = 0; i < 200; i++) {
  const { data, scale } = quantizeInt8(vecs[i]!);
  let dot = 0, na = 0, nb = 0;
  for (let d = 0; d < 384; d++) { const v = data[d]! * scale; dot += v * vecs[i]![d]!; na += v * v; nb += vecs[i]![d]! ** 2; }
  worst = Math.min(worst, dot / (Math.sqrt(na) * Math.sqrt(nb)));
}
console.log(`int8 fidelity: worst cosine(orig, dequant)=${worst.toFixed(4)} over 200 vectors`);
idx.close();
rmSync(path, { force: true });
