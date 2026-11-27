import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { capacities, modelCodes, normalizeProduct } from '../src/match/normalize.ts';
import { cosine, hardConflict, matchProducts, type Embedder } from '../src/match/matcher.ts';
import { buildCentroids, classifyVector } from '../src/match/classify.ts';
import { categorize } from '../src/safqa-core.ts';

/** Deterministic fake embedder: hashed token bag → 384-dim. Lets CI test the
 *  pipeline (blocking/conflicts/thresholds/clustering) without model downloads.
 *  Real-model quality is measured by scripts/bench-embed.ts, not here. */
const fakeEmbed: Embedder = async (texts) => texts.map((t) => {
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

describe('normalize', () => {
  it('extracts model codes and skips generic specs', () => {
    expect(modelCodes('Black + Decker AerOfry Air Fryer 4 Liter 1500W - AF400')).toContain('AF400');
    expect(modelCodes('Laptop 512GB SSD 144Hz HDR10')).toEqual([]);
    expect(modelCodes('هاند بلندر براون 1000 وات MQ50202MBK')).toContain('MQ50202MBK');
  });
  it('extracts capacities in Arabic and English', () => {
    expect(capacities('غسالة 9 كجم 1400 لفة').kg).toBe(9);
    expect(capacities('Air Fryer 4 Liter 1500 Watt').liters).toBe(4);
    expect(capacities('Galaxy A55 256GB 8GB RAM').storageGb).toBe(256);
  });
});

describe('hard conflicts', () => {
  const norm = (title: string) => normalizeProduct({ url: title, title }, categorize);
  it('vetoes different capacities and different model codes', () => {
    expect(hardConflict(norm('Braun Blender MQ50051MBK 350ml'), norm('Braun Blender MQ50202MBK 350ml'))).toBe('model-code');
    expect(hardConflict(norm('Samsung Galaxy A55 128GB'), norm('Samsung Galaxy A55 256GB'))).toBe('storageGb');
    expect(hardConflict(norm('Black Decker Air Fryer AF400 4 Liter'), norm('بلاك آند ديكر مقلاة AF400 4 لتر'))).toBeNull();
  });
});

describe('matcher pipeline (fake embedder)', () => {
  it('merges same product across stores and refuses conflicting chains', async () => {
    const products = [
      { url: 'a1', store: 'btech', brand: 'Black+Decker', title: 'Black + Decker AerOfry Air Fryer 4 Liter Black - AF400' },
      { url: 'a2', store: 'dream2000', brand: 'Black+Decker', title: 'بلاك آند ديكر مقلاة هوائية دجيتال 4 لتر 1500 واط AF400' },
      { url: 'b1', store: 'btech', brand: 'Braun', title: 'Braun MultiQuick Hand Blender 1000W MQ50051MBK' },
      { url: 'b2', store: 'dream2000', brand: 'Braun', title: 'هاند بلندر براون مالتي كويك 1000 وات MQ50202MBK' },
    ];
    const { clusters, stats } = await matchProducts(products, fakeEmbed);
    expect(clusters).toEqual([expect.arrayContaining(['a1', 'a2'])]);
    expect(stats.same).toBeGreaterThanOrEqual(1);
  });

  it('precision/recall on the labeled pair set (lexical-fake embedder floor)', async () => {
    const lines = readFileSync(new URL('../data/pairs.jsonl', import.meta.url), 'utf8').trim().split('\n');
    const labeled = lines.map((l) => JSON.parse(l) as { label: string; a: { url: string; title: string; store: string; brand: string | null; crumbs: string[] }; b: { url: string; title: string; store: string; brand: string | null; crumbs: string[] } });
    expect(labeled.length).toBeGreaterThanOrEqual(100);
    const products = labeled.flatMap((p) => [p.a, p.b]);
    const { pairs } = await matchProducts(products, fakeEmbed);
    const decision = new Map(pairs.map((p) => [[p.a.url, p.b.url].sort().join('|'), p.decision]));
    let tp = 0, fp = 0, fn = 0;
    for (const p of labeled) {
      const d = decision.get([p.a.url, p.b.url].sort().join('|'));
      const predictedSame = d === 'same';
      if (p.label === 'same' && predictedSame) tp++;
      else if (p.label === 'same') fn++;
      else if (predictedSame) fp++;
    }
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    // The fake embedder is a floor, not the product: hard conflicts + matchKey must
    // already give high precision; embedding quality is benched separately.
    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeGreaterThan(0.3);
  });
});

describe('centroid classifier (fake embedder)', () => {
  it('classifies by nearest centroid and rejects unknowns', async () => {
    const model = await buildCentroids([
      { text: 'Samsung Galaxy phone smartphone', category: 'phones' },
      { text: 'iPhone mobile phone', category: 'phones' },
      { text: 'LG washing machine washer', category: 'appliances' },
      { text: 'Bosch fridge refrigerator', category: 'appliances' },
    ], fakeEmbed);
    const [v] = await fakeEmbed(['Xiaomi smartphone phone']);
    expect(classifyVector(model, v!, 0.1).category).toBe('phones');
    const [w] = await fakeEmbed(['zzz qqq unknown']);
    expect(classifyVector(model, w!, 0.9).category).toBeNull();
    expect(cosine(v!, v!)).toBeCloseTo(1);
  });
});
