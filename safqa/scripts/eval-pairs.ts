// Evaluates the matcher on data/pairs.jsonl with a chosen embedder.
// Usage: npx tsx scripts/eval-pairs.ts [fake|minilm|granite97|e5small|e5arabic]
// 'fake' is the deterministic lexical floor used in CI; real models need the
// model cache (SAFQA_MODEL_CACHE, default .model-cache) — never committed.
import { readFileSync } from 'node:fs';
import { matchProducts, type Embedder } from '../src/match/matcher.ts';
import { loadEmbedder, type ModelId } from '../src/match/embed.ts';

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
const t0 = Date.now();
const { pairs, stats } = await matchProducts(labeled.flatMap((p: { a: never; b: never }) => [p.a, p.b]), embed);
const dec = new Map(pairs.map((p) => [[p.a.url, p.b.url].sort().join('|'), p.decision]));
let tp = 0, fp = 0, fn = 0, greySame = 0, greyDiff = 0;
for (const p of labeled) {
  const d = dec.get([p.a.url, p.b.url].sort().join('|'));
  if (p.label === 'same' && d === 'same') tp++;
  else if (p.label === 'same') { fn++; if (d === 'grey') greySame++; }
  else if (d === 'same') fp++;
  else if (d === 'grey') greyDiff++;
}
console.log(`embedder=${which} ms=${Date.now() - t0}`);
console.log('stats', stats);
console.log(`precision=${(tp / Math.max(1, tp + fp)).toFixed(3)} recall=${(tp / Math.max(1, tp + fn)).toFixed(3)} tp=${tp} fp=${fp} fn=${fn} greySame=${greySame} greyDiff=${greyDiff}`);
