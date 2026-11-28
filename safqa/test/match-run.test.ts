import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeEmbedder, readProducts, runMatch } from '../src/match/run-match.ts';

const item = (url: string, title: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ url, title, brand: null, gtin: null, mpn: null, crumbs: [], ...extra });

describe('run-match (CLI path over hunt JSONL)', () => {
  it('reads store JSONL files and skips matches.jsonl + bad lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'safqa-match-'));
    writeFileSync(join(dir, 'btech.jsonl'), item('https://a/1', 'Samsung Galaxy A55 256GB') + '\nnot json\n');
    writeFileSync(join(dir, 'matches.jsonl'), item('https://x/9', 'should be skipped') + '\n');
    const products = readProducts(dir);
    expect(products).toHaveLength(1);
    expect(products[0]!.store).toBe('btech');
  });

  it('matches the same product across stores and writes outputs + vecindex', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'safqa-match-'));
    writeFileSync(join(dir, 'btech.jsonl'), item('https://btech/1', 'Samsung Galaxy A55 256GB 8GB RAM Black') + '\n');
    writeFileSync(join(dir, 'jumia.jsonl'),
      item('https://jumia/2', 'Samsung Galaxy A55 256GB 8GB RAM Black') + '\n' +
      item('https://jumia/3', 'Toshiba Washing Machine 9kg Front Load') + '\n');
    const r = await runMatch({ dir, embed: fakeEmbedder, vecPath: join(dir, 'vec.db') });
    expect(r.products).toBe(3);
    expect(r.pairs.some((p) => p.decision === 'same')).toBe(true);
    expect(r.vecIndexed).toBe(3);
    const lines = readFileSync(join(dir, 'matches.jsonl'), 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const clusters = JSON.parse(readFileSync(join(dir, 'clusters.json'), 'utf8')) as string[][];
    expect(clusters.some((c) => c.includes('https://btech/1') && c.includes('https://jumia/2'))).toBe(true);
  });

  it('empty dir yields zero products, no crash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'safqa-match-'));
    const r = await runMatch({ dir, embed: fakeEmbedder });
    expect(r.products).toBe(0);
    expect(r.pairs).toEqual([]);
  });
});
