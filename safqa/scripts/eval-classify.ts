// Centroid-classifier accuracy on a breadcrumb-labeled sample.
// Ground truth: category derived from the store's own breadcrumbs ONLY
// (categorize('', crumbs)); the classifier sees titles only. Split is by
// product (80/20, seeded). Usage: npx tsx scripts/eval-classify.ts [embedder] [dir ...]
// Extra dirs hold <store>.jsonl hunt outputs (btech/raya/elbadr/jumia carry
// breadcrumbs; dream2000 does not). 'fake' is the lexical floor; real models
// need the model cache.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { categorize } from '../src/safqa-core.ts';
import { buildCentroids, classifyTexts } from '../src/match/classify.ts';
import { loadEmbedder, type ModelId } from '../src/match/embed.ts';
import type { Embedder } from '../src/match/matcher.ts';

const which = process.argv[2] ?? 'fake';
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
const embed = which === 'fake' ? fake : await loadEmbedder(which as ModelId, process.env.SAFQA_MODEL_CACHE ?? '.model-cache');

const labeled = readFileSync(new URL('../data/pairs.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const byUrl = new Map<string, { title: string; crumbs: string[] }>();
for (const p of labeled) for (const side of [p.a, p.b]) byUrl.set(side.url, { title: side.title, crumbs: side.crumbs ?? [] });
for (const dir of process.argv.slice(3)) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as { url: string; title: string; crumbs?: string[] };
      if (r.url && r.title) byUrl.set(r.url, { title: r.title, crumbs: r.crumbs ?? [] });
    }
  }
}
const sample = [...byUrl.values()]
  .map((x) => ({ text: x.title, category: categorize('', x.crumbs) }))
  .filter((x): x is { text: string; category: string } => !!x.category);
console.log(`breadcrumb-labeled sample=${sample.length} categories=${new Set(sample.map((s) => s.category)).size}`);

let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
const shuffled = [...sample].sort(() => rand() - 0.5);
const cut = Math.floor(shuffled.length * 0.8);
const train = shuffled.slice(0, cut), test = shuffled.slice(cut);
const model = await buildCentroids(train, embed);
for (const threshold of [0, 0.2, 0.35]) {
  const results = await classifyTexts(model, test.map((t) => t.text), embed, threshold);
  let correct = 0, rejected = 0;
  results.forEach((r, i) => { if (r.category === null) rejected++; else if (r.category === test[i]!.category) correct++; });
  console.log(`embedder=${which} threshold=${threshold} accuracy=${(correct / test.length).toFixed(3)} rejected=${rejected}/${test.length} train=${train.length} test=${test.length}`);
}
