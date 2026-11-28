import { describe, expect, it } from 'vitest';
import { selectTargets } from '../src/hunt.ts';
import { STORES } from '../src/stores.ts';

describe('selectTargets', () => {
  it('default run includes every store kind (feeds are the fastest channel)', () => {
    const all = selectTargets();
    expect(all.length).toBe(STORES.length);
    expect(all.some((s) => s.kind === 'shopify')).toBe(true);
    expect(all.some((s) => s.kind === 'woocommerce')).toBe(true);
    expect(all.some((s) => s.kind === 'sitemap')).toBe(true);
  });

  it('explicit list still narrows the run', () => {
    const picked = selectTargets(['dream2000', 'btech']);
    expect(picked.map((s) => s.id).sort()).toEqual(['btech', 'dream2000']);
  });

  it('empty list behaves like default', () => {
    expect(selectTargets([]).length).toBe(STORES.length);
  });

  it('kinds filter selects only feed stores (fast continuous cadence)', () => {
    const feeds = selectTargets(undefined, ['shopify', 'woocommerce']);
    expect(feeds.length).toBeGreaterThan(10);
    expect(feeds.every((s) => s.kind === 'shopify' || s.kind === 'woocommerce')).toBe(true);
  });

  it('explicit stores win over kinds', () => {
    const picked = selectTargets(['btech'], ['shopify']);
    expect(picked.map((s) => s.id)).toEqual(['btech']);
  });
});
