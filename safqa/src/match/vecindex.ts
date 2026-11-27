// Local vector index for runner-side embedding search.
// Primary path: sqlite-vec (vec0 tables, int8 vectors) in a SQLite file that CI
// keeps in actions/cache. Fallback: exact brute-force cosine over the same
// int8-quantised vectors held in a plain SQLite table (node:sqlite) — measured
// in scripts/bench-vec.ts; whichever wins on real Safqa volumes is the default.
import { DatabaseSync } from 'node:sqlite';

export const DIM = 384;

/** int8 quantisation: per-vector scale, 384 bytes per vector (vs 1536 float32). */
export function quantizeInt8(vec: Float32Array): { data: Int8Array; scale: number } {
  let max = 0;
  for (const v of vec) max = Math.max(max, Math.abs(v));
  const scale = max > 0 ? max / 127 : 1;
  const data = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) data[i] = Math.round(vec[i]! / scale);
  return { data, scale };
}

export function dequantize(data: Int8Array, scale: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i]! * scale;
  return out;
}

export interface VecHit { key: string; score: number }

export class VecIndex {
  private db: DatabaseSync;
  private vec0: boolean;

  private constructor(db: DatabaseSync, vec0: boolean) { this.db = db; this.vec0 = vec0; }

  /** Opens (creating) the index file. Tries sqlite-vec; falls back to plain table + brute force. */
  static async open(path: string): Promise<VecIndex> {
    const db = new DatabaseSync(path, { allowExtension: true } as never);
    let vec0 = false;
    try {
      const sqliteVec = await import('sqlite-vec');
      sqliteVec.load(db as never);
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(key TEXT PRIMARY KEY, embedding int8[${DIM}])`);
      vec0 = true;
    } catch {
      db.exec(`CREATE TABLE IF NOT EXISTS vec_items (key TEXT PRIMARY KEY, embedding BLOB NOT NULL, scale REAL NOT NULL)`);
    }
    return new VecIndex(db, vec0);
  }

  get usesVec0(): boolean { return this.vec0; }

  upsert(key: string, vec: Float32Array): void {
    const { data, scale } = quantizeInt8(vec);
    if (this.vec0) {
      this.db.prepare(`INSERT OR REPLACE INTO vec_items(key, embedding) VALUES (?, vec_int8(?))`).run(key, Buffer.from(data.buffer, data.byteOffset, data.byteLength) as never);
    } else {
      this.db.prepare(`INSERT OR REPLACE INTO vec_items(key, embedding, scale) VALUES (?, ?, ?)`).run(key, Buffer.from(data.buffer, data.byteOffset, data.byteLength) as never, scale);
    }
  }

  search(query: Float32Array, k = 10): VecHit[] {
    if (this.vec0) {
      const { data } = quantizeInt8(query);
      const rows = this.db.prepare(
        `SELECT key, distance FROM vec_items WHERE embedding MATCH vec_int8(?) ORDER BY distance LIMIT ?`,
      ).all(Buffer.from(data.buffer, data.byteOffset, data.byteLength) as never, k) as { key: string; distance: number }[];
      // vec0 int8 distance is L2 on quantised values; report it as-is (lower = closer) via negative score.
      return rows.map((r) => ({ key: r.key, score: -r.distance }));
    }
    const rows = this.db.prepare(`SELECT key, embedding, scale FROM vec_items`).all() as { key: string; embedding: Uint8Array; scale: number }[];
    const hits: VecHit[] = [];
    let qn = 0;
    for (const v of query) qn += v * v;
    qn = Math.sqrt(qn) || 1;
    for (const r of rows) {
      const data = new Int8Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength);
      let dot = 0, n = 0;
      for (let i = 0; i < data.length; i++) { const v = data[i]! * r.scale; dot += v * query[i]!; n += v * v; }
      hits.push({ key: r.key, score: dot / ((Math.sqrt(n) || 1) * qn) });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }

  count(): number {
    const r = this.db.prepare(`SELECT count(*) AS n FROM vec_items`).get() as { n: number };
    return r.n;
  }

  close(): void { this.db.close(); }
}
