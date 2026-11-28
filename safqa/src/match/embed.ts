// transformers.js embedding loader (Node, ONNX q8). Lazy + optional: nothing
// imports this at module load, so the hunter runs unchanged when SAFQA_EMBED is
// off. Install note: ONNXRUNTIME_NODE_INSTALL=skip avoids the ~600MB CUDA
// download on Linux (CPU runtime is bundled).
import type { Embedder } from './matcher.ts';

export const MODELS = {
  minilm: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  granite97: 'ibm-granite/granite-embedding-97m-multilingual-r2',
  e5small: 'Xenova/multilingual-e5-small',
  e5arabic: 'mzahran1/arabic-english-e5-small-retrieval-v2',
} as const;
export type ModelId = keyof typeof MODELS;

export function embedEnabled(): boolean {
  return process.env.SAFQA_EMBED === '1';
}

/** e5-family models need query:/passage: prefixes; symmetric product titles use passage: on both sides. */
export function withPrefix(model: ModelId, text: string): string {
  return model === 'e5small' || model === 'e5arabic' ? `passage: ${text}` : text;
}

// Per-model ONNX load overrides. granite97's repo ships onnx/model.onnx +
// onnx/model_quint8_avx2.onnx but NO model_quantized.onnx (verified via HF API
// 2026-11-28), so the q8 default 404s; load the quint8 file by name instead
// (dtype fp32 = empty suffix, the graph itself is quint8-quantised).
// e5arabic has NO onnx export at all (safetensors only) — it will fail to load
// here until an ONNX conversion exists; bench reports that honestly.
const LOAD_OPTS: Partial<Record<ModelId, { dtype: 'fp32' | 'q8'; model_file_name?: string }>> = {
  granite97: { dtype: 'fp32', model_file_name: 'model_quint8_avx2' },
};

// Default = measured winner of safqa-ai-bench run 46093281502 (2026-11-28, 698 labeled pairs):
// e5small acc 0.850 / matcher recall 0.787 @ precision 1.000, vs granite97 0.798/0.731, minilm 0.788.
// e5arabic rejected: its repo ships safetensors only, no ONNX export (verified via HF API).
export async function loadEmbedder(model: ModelId = 'e5small', cacheDir?: string): Promise<Embedder> {
  const { pipeline, env } = await import('@huggingface/transformers');
  if (cacheDir) env.cacheDir = cacheDir;
  const opts = LOAD_OPTS[model] ?? { dtype: 'q8' };
  const extractor = await pipeline('feature-extraction', MODELS[model], opts);
  return async (texts: string[]) => {
    const out: Float32Array[] = [];
    const BATCH = 32;
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH).map((t) => withPrefix(model, t));
      const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
      const [n, dim] = tensor.dims as [number, number];
      for (let r = 0; r < n; r++) out.push(new Float32Array(tensor.data.slice(r * dim, (r + 1) * dim) as Float32Array));
    }
    return out;
  };
}
