// Robust per-product price anomaly detection: median absolute deviation (MAD) modified z-score
// plus the IQR fence, computed per canonical product over its own price history. This sits above
// the run-level median check in safqa-core (countAnomalies): history-based, outlier-resistant,
// and flag-only — an anomaly never blocks a send, it marks the observation for review.

export interface AnomalyResult {
  anomalous: boolean;
  method: 'mad' | 'iqr' | 'none';
  median: number | null;
  madZ: number | null; // modified z-score (0.6745 * (x - median) / MAD)
  iqrFence: [number, number] | null;
  samples: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};

/**
 * Is `price` anomalous against this product's own history? Needs ≥5 samples.
 * MAD modified z-score > 3.5 (Iglewicz–Hoaglin) or outside the 1.5×IQR fence → anomalous.
 * When MAD is 0 (flat history), any deviation >25% from the median is anomalous.
 */
export function priceAnomaly(history: number[], price: number, o: { minSamples?: number; zThreshold?: number } = {}): AnomalyResult {
  const xs = history.filter((p) => Number.isFinite(p) && p > 0);
  const none: AnomalyResult = { anomalous: false, method: 'none', median: null, madZ: null, iqrFence: null, samples: xs.length };
  if (!(price > 0) || xs.length < (o.minSamples ?? 5)) return none;
  const med = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - med)));
  const q1 = quantile(xs, 0.25), q3 = quantile(xs, 0.75), iqr = q3 - q1;
  const fence: [number, number] = [q1 - 1.5 * iqr, q3 + 1.5 * iqr];
  const z = mad > 0 ? (0.6745 * (price - med)) / mad : null;
  const zHit = z != null ? Math.abs(z) > (o.zThreshold ?? 3.5) : Math.abs(price - med) / med > 0.25;
  const iqrHit = iqr > 0 && (price < fence[0] || price > fence[1]); // flat history: IQR fence degenerates to a point; the 25% rule governs
  return {
    anomalous: zHit || iqrHit,
    method: zHit ? 'mad' : iqrHit ? 'iqr' : 'none',
    median: med, madZ: z, iqrFence: fence, samples: xs.length,
  };
}

/** Run-level rollup: how many observations in this run are anomalous vs their product history. */
export function countHistoryAnomalies(
  observations: { key: string; price: number }[],
  historyByKey: Record<string, number[]>,
): { count: number; flagged: { key: string; price: number; result: AnomalyResult }[] } {
  const flagged: { key: string; price: number; result: AnomalyResult }[] = [];
  for (const ob of observations) {
    const r = priceAnomaly(historyByKey[ob.key] ?? [], ob.price);
    if (r.anomalous) flagged.push({ key: ob.key, price: ob.price, result: r });
  }
  return { count: flagged.length, flagged };
}
