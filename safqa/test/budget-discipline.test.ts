import { describe, expect, it } from 'vitest';
import { BATCH_SIZE, HEAL_CAP, MIN_ROOM, TIGHT_ROOM, UNCHANGED_WINDOW_MS } from '../src/config.ts';
import { Sink } from '../src/sink.ts';
import type { Item } from '../src/extract/jsonld.ts';

const item = (n: number): Item => ({ url: `https://x.example/p${n}`, title: `P${n}`, brand: null, price: 100 + n, listPrice: null, currency: 'EGP', inStock: true, image: null, gtin: null, mpn: null, crumbs: [] });

describe('D1 write-budget discipline defaults', () => {
  it('refresh window is 7 days, batch 25, minRoom 8000, heal cap 50', () => {
    expect(UNCHANGED_WINDOW_MS).toBe(7 * 86400_000);
    expect(BATCH_SIZE).toBe(25);
    expect(MIN_ROOM).toBe(8000);
    expect(HEAL_CAP).toBe(50);
    expect(TIGHT_ROOM).toBeGreaterThan(MIN_ROOM);
  });
  it('dry sink flushes in batches of BATCH_SIZE and counts every item once', async () => {
    const sink = new Sink('teststore', true);
    for (let i = 0; i < 60; i++) await sink.add(item(i));
    await sink.flush();
    expect(sink.stats.sent).toBe(60);
    expect(sink.stats.budgetStop).toBe(false);
  });
});
