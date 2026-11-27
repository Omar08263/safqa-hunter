import { describe, expect, it } from 'vitest';
import {
  HealLlmBudget, HealLlmSession, buildPrompt, healLlmAdopt, healLlmMode,
  parseSelectorOutput, validateSelector, type LlmProposer,
} from '../src/heal-llm.ts';

// No model is downloaded in CI: every test mocks the proposer's raw output.
const page = (priceHtml: string, extra = '') => `<html><head><title>منتج</title></head><body>
  <h1>Samsung Galaxy A55</h1>${extra}<div class="buy-box">${priceHtml}</div></body></html>`;
const GOOD = page('<span class="final-cost">18,999 جنيه</span>');
const GOOD2 = page('<span class="final-cost">21,499 جنيه</span>'); // same template, other product
const mock = (out: string | null): LlmProposer & { calls: number } => {
  const fn = (async () => { fn.calls++; return out; }) as unknown as LlmProposer & { calls: number };
  fn.calls = 0;
  return fn;
};
const env = (v: Record<string, string>) => v as NodeJS.ProcessEnv;

describe('flags (off by default, adoption separate)', () => {
  it('defaults to off and no adoption', () => {
    expect(healLlmMode(env({}))).toBe('off');
    expect(healLlmMode(env({ SAFQA_HEAL_LLM: 'banana' }))).toBe('off');
    expect(healLlmAdopt(env({}))).toBe(false);
  });
  it('shadow/on need the exact values; adopt needs its own flag', () => {
    expect(healLlmMode(env({ SAFQA_HEAL_LLM: 'shadow' }))).toBe('shadow');
    expect(healLlmMode(env({ SAFQA_HEAL_LLM: 'ON' }))).toBe('on');
    expect(healLlmAdopt(env({ SAFQA_HEAL_LLM_ADOPT: '1' }))).toBe(true);
    expect(healLlmAdopt(env({ SAFQA_HEAL_LLM_ADOPT: 'yes' }))).toBe(false);
  });
  it('off mode never calls the model', async () => {
    const p = mock('{"selector":".final-cost"}');
    const s = new HealLlmSession('x', { proposer: p, env: env({}) });
    expect(await s.tryHeal(GOOD, 'https://s.example/1', [])).toBeNull();
    expect(p.calls).toBe(0);
  });
});

describe('strict output parsing — the model may never write a price', () => {
  it('accepts a bare selector JSON, also inside prose/think tags', () => {
    expect(parseSelectorOutput('{"selector":".final-cost"}')).toBe('.final-cost');
    expect(parseSelectorOutput('<think>hmm</think> {"selector":"div.buy > span"} done')).toBe('div.buy > span');
  });
  it('survives prompt echo: skips the example object, last valid selector wins', () => {
    const echo = 'Reply with ONLY {"selector":"<css selector>"} or {"selector":null}. ... {"selector":".final-cost"}';
    expect(parseSelectorOutput(echo)).toBe('.final-cost');
    expect(parseSelectorOutput('{"selector":"<css selector>"}')).toBeNull();
  });
  it('rejects prices, XPath, markup, garbage and null', () => {
    expect(parseSelectorOutput('{"price":18999}')).toBeNull();
    expect(parseSelectorOutput('18999 جنيه')).toBeNull();
    expect(parseSelectorOutput('{"selector":"//div[@class=\'x\']"}')).toBeNull();
    expect(parseSelectorOutput('{"selector":"<b>.x</b>"}')).toBeNull();
    expect(parseSelectorOutput('{"selector":null}')).toBeNull();
    expect(parseSelectorOutput('')).toBeNull();
    expect(parseSelectorOutput(null)).toBeNull();
  });
});

describe('the five deterministic checks (a)-(d) per page', () => {
  it('passes all checks and reads the price by code (Arabic digits too)', () => {
    const v = validateSelector(GOOD, '.final-cost', []);
    expect(v.ok).toBe(true);
    expect(v.price).toBe(18999);
    const ar = validateSelector(page('<span class="final-cost">١٨٬٩٩٩ ج.م</span>'), '.final-cost', []);
    expect(ar.ok).toBe(true);
    expect(ar.price).toBe(18999);
  });
  it('(a) plausible: a 5 EGP "price" is rejected', () => {
    const v = validateSelector(page('<span class="final-cost">5 جنيه</span>'), '.final-cost', []);
    expect(v.ok).toBe(false);
    expect(v.failedCheck).toBe('plausible');
  });
  it('(b) pattern: element without a price pattern is rejected', () => {
    const v = validateSelector(page('<span class="final-cost">شحن مجاني</span>'), '.final-cost', []);
    expect(v.ok).toBe(false);
    expect(v.failedCheck).toBe('pattern');
  });
  it('(c) conflict: a different price already extracted from the page wins', () => {
    const v = validateSelector(GOOD, '.final-cost', [15999]);
    expect(v.ok).toBe(false);
    expect(v.failedCheck).toBe('conflict');
    expect(validateSelector(GOOD, '.final-cost', [18999]).ok).toBe(true); // same price: no conflict
  });
  it('(d) single: a selector matching a list is rejected', () => {
    const list = page('<span class="final-cost">18,999 جنيه</span><span class="final-cost">21,499 جنيه</span>');
    const v = validateSelector(list, '.final-cost', []);
    expect(v.ok).toBe(false);
    expect(v.failedCheck).toBe('single');
  });
});

describe('session: shadow first, (e) second page before adoption, cap, isolation', () => {
  const shadow = env({ SAFQA_HEAL_LLM: 'shadow' });
  it('first page: proposal validated but only shadow-recorded (no adoption)', async () => {
    const s = new HealLlmSession('x', { proposer: mock('{"selector":".final-cost"}'), env: shadow });
    expect(await s.tryHeal(GOOD, 'https://s.example/1', [])).toBeNull();
    const sum = s.summary();
    expect(sum).toMatchObject({ mode: 'shadow', calls: 1, proposals: 1, validated: 1, proven: 0, adopted: 0 });
    expect(sum.records[0]).toMatchObject({ outcome: 'shadow', price: 18999 });
  });
  it('(e) second page of same store proves the selector; shadow still adopts nothing', async () => {
    const s = new HealLlmSession('x', { proposer: mock('{"selector":".final-cost"}'), env: shadow });
    await s.tryHeal(GOOD, 'https://s.example/1', []);
    expect(await s.tryHeal(GOOD2, 'https://s.example/2', [])).toBeNull();
    expect(s.summary()).toMatchObject({ proven: 1, adopted: 0, calls: 1 }); // 2nd page needed no model call
  });
  it('on + adopt flag: proven selector price is adopted from the second page on', async () => {
    const on = env({ SAFQA_HEAL_LLM: 'on', SAFQA_HEAL_LLM_ADOPT: '1' });
    const s = new HealLlmSession('x', { proposer: mock('{"selector":".final-cost"}'), env: on });
    expect(await s.tryHeal(GOOD, 'https://s.example/1', [])).toBeNull(); // first page never adopted
    expect(await s.tryHeal(GOOD2, 'https://s.example/2', [])).toEqual({ price: 21499, selector: '.final-cost' });
    expect(s.summary().adopted).toBe(1);
  });
  it('on WITHOUT adopt flag: proven but still nothing adopted', async () => {
    const on = env({ SAFQA_HEAL_LLM: 'on' });
    const s = new HealLlmSession('x', { proposer: mock('{"selector":".final-cost"}'), env: on });
    await s.tryHeal(GOOD, 'https://s.example/1', []);
    expect(await s.tryHeal(GOOD2, 'https://s.example/2', [])).toBeNull();
    expect(s.summary()).toMatchObject({ proven: 1, adopted: 0 });
  });
  it('a model that answers with a price instead of a selector is never adopted', async () => {
    const on = env({ SAFQA_HEAL_LLM: 'on', SAFQA_HEAL_LLM_ADOPT: '1' });
    const s = new HealLlmSession('x', { proposer: mock('{"price":18999}'), env: on });
    expect(await s.tryHeal(GOOD, 'https://s.example/1', [])).toBeNull();
    expect(s.summary().records[0]?.outcome).toBe('no-proposal');
  });
  it('cap: shared budget stops model calls (≤30/run, here 2)', async () => {
    const p = mock('{"selector":".nope"}');
    const budget = new HealLlmBudget(2);
    const s = new HealLlmSession('x', { proposer: p, env: shadow, budget });
    await s.tryHeal(GOOD, 'https://s.example/1', []);
    await s.tryHeal(GOOD, 'https://s.example/2', []);
    await s.tryHeal(GOOD, 'https://s.example/3', []);
    expect(p.calls).toBe(2);
    expect(s.summary().records.at(-1)?.outcome).toBe('cap');
  });
  it('model failure (throw / timeout / null) never breaks the hunt', async () => {
    const boom: LlmProposer = async () => { throw new Error('no binary'); };
    const s1 = new HealLlmSession('x', { proposer: boom, env: shadow });
    expect(await s1.tryHeal(GOOD, 'https://s.example/1', [])).toBeNull();
    const slow: LlmProposer = () => new Promise((r) => setTimeout(() => r('{"selector":".final-cost"}'), 200));
    const s2 = new HealLlmSession('x', { proposer: slow, env: shadow, timeoutMs: 20 });
    expect(await s2.tryHeal(GOOD, 'https://s.example/1', [])).toBeNull();
    expect(s2.summary().records[0]?.outcome).toBe('error');
  });
  it('rejected proposals record the failed check (silent reject, logged)', async () => {
    const s = new HealLlmSession('x', { proposer: mock('{"selector":".final-cost"}'), env: shadow });
    const bad = page('<span class="final-cost">5 جنيه</span>');
    expect(await s.tryHeal(bad, 'https://s.example/1', [])).toBeNull();
    expect(s.summary().records[0]).toMatchObject({ outcome: 'rejected', failedCheck: 'plausible' });
  });
});

describe('prompt building', () => {
  it('lists price-like elements with CSS paths and forbids prices in output', () => {
    const p = buildPrompt(GOOD, 'https://s.example/1', 'Galaxy A55');
    expect(p).toContain('.final-cost');
    expect(p).toContain('18,999');
    expect(p).toContain('Never output a price');
    expect(p).not.toContain('<script');
  });
});
