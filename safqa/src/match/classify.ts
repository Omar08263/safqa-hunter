// Centroid classifier: category centroids from breadcrumb-confident products,
// classify the rest by nearest centroid with a reject threshold. Zero new models —
// reuses the same embedder as the matcher.
import { cosine, type Embedder } from './matcher.ts';

export interface LabeledText { text: string; category: string }

export interface CentroidModel {
  centroids: Map<string, Float32Array>;
  counts: Map<string, number>;
}

export async function buildCentroids(labeled: LabeledText[], embed: Embedder): Promise<CentroidModel> {
  const vecs = await embed(labeled.map((l) => l.text));
  const sums = new Map<string, { sum: Float32Array; n: number }>();
  labeled.forEach((l, i) => {
    const cur = sums.get(l.category) ?? { sum: new Float32Array(vecs[i]!.length), n: 0 };
    for (let d = 0; d < cur.sum.length; d++) cur.sum[d]! += vecs[i]![d]!;
    cur.n++;
    sums.set(l.category, cur);
  });
  const centroids = new Map<string, Float32Array>();
  const counts = new Map<string, number>();
  for (const [cat, { sum, n }] of sums) {
    const c = new Float32Array(sum.length);
    let norm = 0;
    for (let d = 0; d < sum.length; d++) { c[d] = sum[d]! / n; norm += c[d]! * c[d]!; }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < c.length; d++) c[d]! /= norm;
    centroids.set(cat, c);
    counts.set(cat, n);
  }
  return { centroids, counts };
}

export interface ClassifyResult { category: string | null; score: number; runnerUp: number }

/** Nearest centroid; rejected (null) when the best score is under the threshold. */
export function classifyVector(model: CentroidModel, vec: Float32Array, threshold = 0.35): ClassifyResult {
  let best: string | null = null, bestScore = -1, runnerUp = -1;
  for (const [cat, c] of model.centroids) {
    const s = cosine(vec, c);
    if (s > bestScore) { runnerUp = bestScore; bestScore = s; best = cat; }
    else if (s > runnerUp) runnerUp = s;
  }
  return { category: bestScore >= threshold ? best : null, score: bestScore, runnerUp };
}

export async function classifyTexts(model: CentroidModel, texts: string[], embed: Embedder, threshold = 0.35): Promise<ClassifyResult[]> {
  const vecs = await embed(texts);
  return vecs.map((v) => classifyVector(model, v, threshold));
}
