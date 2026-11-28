// Measured embedding-model comparison on the labeled pair set.
// Usage: npx tsx scripts/bench-embed.ts [model ...]   (default: all four)
// Models download into SAFQA_MODEL_CACHE (default .model-cache) — in CI that
// dir is actions/cache, never the repo. Reports, per model: same/different
// cosine distributions (mean, p5/p95, min/max), best-threshold accuracy,
// ms/product and peak RSS delta.
import { readFileSync } from 'node:fs';
import { cosine } from '../src/match/matcher.ts';
import { loadEmbedder, MODELS, type ModelId } from '../src/match/embed.ts';

const models = (process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODELS)) as ModelId[];
const labeled = readFileSync(new URL('../data/pairs.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const texts = [...new Set(labeled.flatMap((p: { a: { title: string }; b: { title: string } }) => [p.a.title, p.b.title]))];
console.log(`pairs=${labeled.length} uniqueTitles=${texts.length}`);

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: s[0]!, p5: q(0.05), p50: q(0.5), p95: q(0.95), max: s[s.length - 1]! };
};
const fmt = (x: number) => x.toFixed(3);

for (const model of models) {
  const rss0 = process.memoryUsage().rss;
  const tLoad = Date.now();
  let embed;
  try {
    embed = await loadEmbedder(model, process.env.SAFQA_MODEL_CACHE ?? '.model-cache');
  } catch (e) {
    console.log(`\n== ${model} (${MODELS[model]}): LOAD FAILED: ${(e as Error).message.slice(0, 200)}`);
    continue;
  }
  const loadMs = Date.now() - tLoad;
  const t0 = Date.now();
  const vecs = await embed(texts);
  const embedMs = Date.now() - t0;
  const rss1 = process.memoryUsage().rss;
  const vecOf = new Map(texts.map((t, i) => [t, vecs[i]!]));
  const same: number[] = [], diff: number[] = [];
  for (const p of labeled) {
    const s = cosine(vecOf.get(p.a.title)!, vecOf.get(p.b.title)!);
    (p.label === 'same' ? same : diff).push(s);
  }
  // Best single threshold by accuracy, plus the proven-baseline comparison points.
  let best = { t: 0, acc: 0 };
  for (let t = 0.3; t <= 0.95; t += 0.01) {
    const acc = (same.filter((s) => s >= t).length + diff.filter((s) => s < t).length) / labeled.length;
    if (acc > best.acc) best = { t, acc };
  }
  const ss = stats(same), ds = stats(diff);
  console.log(`\n== ${model} (${MODELS[model]})`);
  console.log(`load=${loadMs}ms embed=${embedMs}ms (${(embedMs / texts.length).toFixed(1)}ms/product) rssDelta=${((rss1 - rss0) / 1048576).toFixed(0)}MB dim=${vecs[0]!.length}`);
  console.log(`same:      mean=${fmt(ss.mean)} p5=${fmt(ss.p5)} p50=${fmt(ss.p50)} min=${fmt(ss.min)}`);
  console.log(`different: mean=${fmt(ds.mean)} p95=${fmt(ds.p95)} p50=${fmt(ds.p50)} max=${fmt(ds.max)}`);
  console.log(`separation: sameMean-diffMean=${fmt(ss.mean - ds.mean)} sameP5-diffP95=${fmt(ss.p5 - ds.p95)} bestThreshold=${best.t.toFixed(2)} acc=${fmt(best.acc)}`);
}
