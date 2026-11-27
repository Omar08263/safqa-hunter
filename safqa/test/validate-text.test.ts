import { describe, expect, it } from 'vitest';
import { checkItem } from '../src/validate.ts';
import { cleanDescription, parsePrice, toLatinDigits } from '../src/text.ts';
import type { Item } from '../src/extract/jsonld.ts';

const base: Item = { url: 'https://btech.com/en/p/x', title: 'Galaxy A55 256GB', brand: 'Samsung', price: 18999, listPrice: 21000, currency: 'EGP', inStock: true, image: 'https://img.example/a.jpg', gtin: '8806095000000', mpn: null, crumbs: ['Mobiles'] };

describe('Zod observation gate', () => {
  it('accepts a well-formed item and normalises it', () => {
    const r = checkItem({ ...base, title: '  Galaxy A55 256GB  ', currency: 'egp' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.item.title).toBe('Galaxy A55 256GB'); expect(r.item.currency).toBe('EGP'); }
  });
  it('rejects zero/negative price, non-EGP currency, bad URL, empty title', () => {
    expect(checkItem({ ...base, price: 0 }).ok).toBe(false);
    expect(checkItem({ ...base, price: -5 }).ok).toBe(false);
    expect(checkItem({ ...base, currency: 'USD' }).ok).toBe(false);
    expect(checkItem({ ...base, url: 'not-a-url' }).ok).toBe(false);
    expect(checkItem({ ...base, title: '   ' }).ok).toBe(false);
  });
  it('drops a junk GTIN instead of failing the whole item; drops listPrice <= price', () => {
    const r = checkItem({ ...base, gtin: 'N/A', listPrice: 100 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.item.gtin).toBeNull(); expect(r.item.listPrice).toBeNull(); }
  });
  it('drops a non-URL image ("undefined", junk, relative) to null instead of invalidating the item (IKEA)', () => {
    for (const image of ['undefined', 'null', 'not-a-url', '/img/x.jpg', '']) {
      const r = checkItem({ ...base, image });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.item.image).toBeNull();
    }
    const ok = checkItem({ ...base, image: 'https://img.example/a.jpg' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.item.image).toBe('https://img.example/a.jpg');
  });
});

describe('Arabic digits + price parsing', () => {
  it('converts Arabic-Indic digits both scripts', () => {
    expect(toLatinDigits('١٢٣٤٥')).toBe('12345');
    expect(toLatinDigits('۱۲۳')).toBe('123');
    expect(toLatinDigits('Galaxy A55')).toBe('Galaxy A55');
  });
  it('parses Arabic-digit prices with separators', () => {
    expect(parsePrice('١٨٬٩٩٩')).toBe(18999);
    expect(parsePrice('EGP 1,250.50')).toBe(1250.5);
    expect(parsePrice('١٢٥٠٫٥')).toBe(1250.5);
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(0)).toBeNull();
  });
});

describe('description cleaning (turndown)', () => {
  it('strips scripts and markup, keeps text', () => {
    const out = cleanDescription('<p>شاشة <b>AMOLED</b></p><script>alert(1)</script><ul><li>256GB</li></ul>');
    expect(out).toContain('AMOLED');
    expect(out).toContain('256GB');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('<');
  });
  it('returns null for empty input', () => {
    expect(cleanDescription('')).toBeNull();
    expect(cleanDescription(null)).toBeNull();
  });
});
