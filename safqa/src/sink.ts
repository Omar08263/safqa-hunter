// Write-budget-aware sink. Sends small batches to the Safqa Worker, which owns matching, price history and the
// D1 write budget (100k rows/day for the whole account on the free plan). Stops the moment the API says the
// budget is used up. Dry runs write JSONL instead.
import { appendFileSync, mkdirSync } from 'node:fs';
import { API, BATCH_SIZE, TOKEN } from './config.ts';
import type { Item } from './extract/jsonld.ts';

export interface SinkStats { sent: number; created: number; merged: number; rejected: number; budgetStop: boolean; lastUsed?: number }
export class Sink {
  private buf: Item[] = [];
  stats: SinkStats = { sent: 0, created: 0, merged: 0, rejected: 0, budgetStop: false };
  constructor(private store: string, private dry: boolean, private batch = BATCH_SIZE) { if (dry) mkdirSync('out', { recursive: true }); }
  async add(it: Item) { if (this.stats.budgetStop) return false; this.buf.push(it); if (this.buf.length >= this.batch) await this.flush(); return !this.stats.budgetStop; }
  async flush() {
    if (!this.buf.length) return;
    const items = this.buf.splice(0);
    if (this.dry) { for (const it of items) appendFileSync(`out/${this.store}.jsonl`, JSON.stringify(it) + '\n'); this.stats.sent += items.length; return; }
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`${API}/api/v5/hunter/batch`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ store: this.store, items }) }).catch(() => null);
      if (r?.ok) {
        const j = await r.json() as { ok: boolean; budget?: boolean; used?: number; results?: { status: string }[] };
        this.stats.lastUsed = j.used;
        if (j.budget || !j.ok) { this.stats.budgetStop = true; return; }
        for (const x of j.results ?? []) { this.stats.sent++; if (x.status === 'created') this.stats.created++; else if (x.status === 'merged') this.stats.merged++; else this.stats.rejected++; }
        return;
      }
      await new Promise((res) => setTimeout(res, 5000 * (attempt + 1)));
    }
  }
}
export async function getBudget(): Promise<{ used: number; bgCap: number; exhausted?: boolean; state: string } | null> {
  const r = await fetch(`${API}/api/v5/budget`).catch(() => null);
  return r?.ok ? r.json() as Promise<{ used: number; bgCap: number; exhausted?: boolean; state: string }> : null;
}
export async function getPlan(store: string) {
  if (!TOKEN) return [];
  const r = await fetch(`${API}/api/v5/hunter/plan?store=${encodeURIComponent(store)}&limit=300`, { headers: { authorization: `Bearer ${TOKEN}` } }).catch(() => null);
  return r?.ok ? ((await r.json()) as { urls: { url: string; heat: number; checked_at: string | null; watchers: number }[] }).urls : [];
}
export async function heal(host: string, title: string, candidates: { cls: string; text: string }[]) {
  if (!TOKEN || !candidates.length) return null;
  const r = await fetch(`${API}/api/v5/hunter/heal`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ host, title, candidates }) }).catch(() => null);
  return r?.ok ? ((await r.json()) as { result: { price: number; title: string } | null }).result : null;
}
export async function report(run: Record<string, unknown>) {
  if (!TOKEN) return;
  await fetch(`${API}/api/v5/hunter/report`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(run) }).catch(() => undefined);
}
