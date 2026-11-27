// Sixth healing layer (LLM, proposal-only, OFF by default): a local quantized model
// (Qwen3-1.7B Q4_K_M GGUF via llama.cpp — see RESEARCH-AI-MODELS.md §4/§7) proposes a CSS
// selector for a page where every deterministic layer failed. The model NEVER writes a price:
// the price is read by deterministic code from the proposed element and must pass five checks
// (a) plausibleEgp range, (b) price pattern in the element text, (c) no conflict with any other
// price extracted from the same page, (d) selector matches exactly one element, (e) the same
// selector also passes (a)-(d) on a second page from the same store before any adoption.
// Any failed check = silent reject. Shadow first: proposals are only logged (health/logs)
// until their accuracy is measured; adoption needs SAFQA_HEAL_LLM=on AND SAFQA_HEAL_LLM_ADOPT=1.
// Model/binary live in actions/cache, never in the repo. Any failure here must never break a hunt.
import { spawn } from 'node:child_process';
import { load } from 'cheerio';
import { HEAL_LLM_CAP, HEAL_LLM_MODEL, HEAL_LLM_TIMEOUT_MS, LLAMA_BIN } from './config.ts';
import { plausibleEgp } from './safqa-core.ts';
import { parsePrice, toLatinDigits } from './text.ts';

export type HealLlmMode = 'off' | 'shadow' | 'on';

/** SAFQA_HEAL_LLM: 'off' (default) | 'shadow' (propose+validate+log only) | 'on' (may adopt, still gated). */
export function healLlmMode(env: NodeJS.ProcessEnv = process.env): HealLlmMode {
  const v = (env.SAFQA_HEAL_LLM ?? 'off').toLowerCase();
  return v === 'shadow' || v === 'on' ? v : 'off';
}
/** Adoption is a separate, explicit flag: even in 'on' mode nothing is adopted without it. */
export function healLlmAdopt(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SAFQA_HEAL_LLM_ADOPT === '1';
}

/** Shared per-run budget of model calls (hard cap: 30 pages/run across all stores). */
export class HealLlmBudget {
  private used = 0;
  constructor(readonly cap: number = HEAL_LLM_CAP) {}
  tryConsume(): boolean { if (this.used >= this.cap) return false; this.used++; return true; }
  get calls(): number { return this.used; }
  get exhausted(): boolean { return this.used >= this.cap; }
}

// ---------------- model runner (llama.cpp binary; mocked in tests) ----------------
export type LlmProposer = (prompt: string) => Promise<string | null>;

/** Default proposer: spawns llama-cli once per call, temperature 0, killed on timeout. */
export const llamaCppProposer: LlmProposer = (prompt) => new Promise((resolve) => {
  let out = '';
  let settled = false;
  const done = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
  try {
    const child = spawn(LLAMA_BIN, ['-m', HEAL_LLM_MODEL, '-p', prompt, '-n', '160', '-c', '4096', '--temp', '0', '--no-warmup', '--cache-ram', '0', '-st'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } done(null); }, HEAL_LLM_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); if (out.length > 65_536) { try { child.kill('SIGKILL'); } catch { /* gone */ } } });
    child.on('error', () => { clearTimeout(timer); done(null); });
    child.on('close', () => { clearTimeout(timer); done(out || null); });
  } catch { done(null); }
});

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

// ---------------- prompt: compact DOM outline, never raw page ----------------
const PRICE_TEXT_RE = /(?:EGP|LE|ج\.?م|جنيه)\s*\d[\d,.\s٬٫]*|\d[\d,.\s٬٫]*\s*(?:EGP|LE|ج\.?م|جنيه)/i;
const PURE_NUMBER_RE = /^\d[\d,.٬٫]*\d$|^\d$/;

function cssPath($: ReturnType<typeof load>, el: unknown): string {
  const parts: string[] = [];
  let node: any = el;
  for (let depth = 0; node && depth < 5; depth++) {
    const tag = String(node.tagName ?? '').toLowerCase();
    if (!tag || tag === 'html' || tag === 'body') break;
    let part = tag;
    const id = $(node).attr('id');
    if (id && /^[A-Za-z][\w-]*$/.test(id)) { parts.unshift(`${tag}#${id}`); break; }
    const cls = ($(node).attr('class') ?? '').split(/\s+/).filter((c) => /^[A-Za-z][\w-]*$/.test(c)).slice(0, 2);
    if (cls.length) part += '.' + cls.join('.');
    const parent = $(node).parent();
    if (parent.length) {
      const sibs = parent.children(tag);
      if (sibs.length > 1) part += `:nth-of-type(${sibs.index(node as never) + 1})`;
    }
    parts.unshift(part);
    node = parent.get(0);
  }
  return parts.join(' > ');
}

/** Build the prompt: price-like elements with CSS paths + texts. The model picks one path. */
export function buildPrompt(html: string, url: string, title: string): string {
  const $ = load(html);
  $('script,style,noscript,iframe,svg').remove();
  const seen = new Set<string>();
  const lines: string[] = [];
  const consider = (el: unknown) => {
    if (lines.length >= 25) return;
    const text = $(el as never).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length > 90 || !/\d/.test(toLatinDigits(text))) return;
    const path = cssPath($, el);
    if (!path || seen.has(path)) return;
    seen.add(path);
    lines.push(`- ${path} :: "${text.slice(0, 80)}"`);
  };
  $('[class*="price" i],[id*="price" i],[itemprop="price"],[data-price]').each((_, el) => consider(el));
  if (lines.length < 25) {
    $('span,div,p,strong,b,ins,del,li,td').each((_, el) => {
      if ($(el).children().length > 2) return; // leaf-ish only
      const text = toLatinDigits($(el).text().replace(/\s+/g, ' ').trim());
      if (PRICE_TEXT_RE.test(text) || PURE_NUMBER_RE.test(text)) consider(el);
    });
  }
  const system = 'You locate the current selling price element on an Egyptian e-commerce product page. Reply with ONLY one JSON object: {"selector":"<css selector>"} or {"selector":null}. Never output a price, a number, or any explanation.';
  const user = `Product page: ${url}\nTitle: ${title.slice(0, 120)}\nCandidate elements (CSS path :: text):\n${lines.join('\n') || '(none)'}\nPick the ONE element that holds the product's current selling price in EGP. Ignore old/list prices, installment amounts, shipping fees, ratings and discounts. /no_think`;
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`;
}

/** Strict output parse: only a JSON object with a CSS "selector" string survives. A model that
 *  answers with a price (or anything else) is rejected — it may never write prices. llama-cli
 *  echoes the prompt (which itself contains an example object), so invalid candidates are
 *  skipped and the LAST valid selector wins — the model's answer comes after the echo. */
export function parseSelectorOutput(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  let found: string | null = null;
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    try {
      const obj = JSON.parse(m[0]) as { selector?: unknown };
      if (typeof obj.selector !== 'string') continue;
      const sel = obj.selector.trim();
      if (!sel || sel.length > 200) continue;
      if (/[<{};`]/.test(sel) || sel.startsWith('/') || /javascript:/i.test(sel)) continue; // CSS only ('>' child combinator is legal), no XPath/markup
      found = sel;
    } catch { /* try next candidate object */ }
  }
  return found;
}

// ---------------- the five deterministic checks ----------------
export interface HealCheck { name: 'plausible' | 'pattern' | 'conflict' | 'single' | 'second-page'; ok: boolean; detail?: string }
export interface SelectorVerdict { ok: boolean; price: number | null; checks: HealCheck[]; failedCheck?: HealCheck['name'] }

/** Checks (a)-(d) on one page. (e) is enforced by the session (selector must pass here twice,
 *  on two different pages of the same store, before adoption). */
export function validateSelector(html: string, selector: string, knownPrices: number[], category?: string | null): SelectorVerdict {
  const checks: HealCheck[] = [];
  let price: number | null = null;
  try {
    const $ = load(html);
    let els: ReturnType<typeof $>;
    try { els = $(selector); } catch { els = $([]); }
    const single = els.length === 1;
    checks.push({ name: 'single', ok: single, detail: `${els.length} element(s)` });
    const text = single ? els.text().replace(/\s+/g, ' ').trim() : '';
    const latin = toLatinDigits(text);
    const pattern = !!text && (PRICE_TEXT_RE.test(latin) || PURE_NUMBER_RE.test(latin));
    price = pattern ? parsePrice(text) : null;
    checks.push({ name: 'pattern', ok: pattern && price != null, detail: text.slice(0, 60) });
    checks.push({ name: 'plausible', ok: price != null && plausibleEgp(price, category), detail: price != null ? String(price) : 'no price' });
    const conflict = price == null ? false : knownPrices.some((p) => plausibleEgp(p, category) && Math.abs(p - price!) / Math.max(p, price!) > 0.005);
    checks.push({ name: 'conflict', ok: !conflict, detail: conflict ? `known=[${knownPrices.join(',')}]` : undefined });
  } catch {
    checks.push({ name: 'single', ok: false, detail: 'parse error' });
  }
  const failed = checks.find((c) => !c.ok);
  return { ok: !failed, price: failed ? null : price, checks, failedCheck: failed?.name };
}

// ---------------- per-store session (shadow-first) ----------------
export interface HealLlmRecord { url: string; selector: string | null; price: number | null; outcome: 'shadow' | 'adopted' | 'rejected' | 'proven' | 'no-proposal' | 'error' | 'cap'; failedCheck?: string; at: string }
export interface HealLlmSummary { mode: HealLlmMode; adopt: boolean; calls: number; proposals: number; validated: number; proven: number; adopted: number; rejected: number; records: HealLlmRecord[] }

export class HealLlmSession {
  private pending = new Map<string, string>(); // selector -> first page url (check e: needs a 2nd page)
  private proven = new Set<string>();
  private records: HealLlmRecord[] = [];
  private stats = { proposals: 0, validated: 0, proven: 0, adopted: 0, rejected: 0 };
  constructor(
    readonly storeId: string,
    private opts: { proposer?: LlmProposer; env?: NodeJS.ProcessEnv; budget?: HealLlmBudget; timeoutMs?: number } = {},
  ) {}
  private get mode(): HealLlmMode { return healLlmMode(this.opts.env ?? process.env); }
  private get budget(): HealLlmBudget { return this.opts.budget ?? (this.ownBudget ??= new HealLlmBudget()); }
  private ownBudget?: HealLlmBudget;
  private record(r: Omit<HealLlmRecord, 'at'>) { if (this.records.length < 60) this.records.push({ ...r, at: new Date().toISOString() }); }
  summary(): HealLlmSummary {
    return { mode: this.mode, adopt: healLlmAdopt(this.opts.env ?? process.env), calls: this.budget.calls, ...this.stats, records: this.records };
  }

  /** Try to heal one failed page. Returns an adopted price ONLY for a selector already proven
   *  on two pages of this store, in 'on' mode with the adopt flag. Otherwise null (shadow). */
  async tryHeal(html: string, url: string, knownPrices: number[], title = '', category?: string | null): Promise<{ price: number; selector: string } | null> {
    if (this.mode === 'off') return null;
    try {
      const canAdopt = this.mode === 'on' && healLlmAdopt(this.opts.env ?? process.env);
      // 1) proven selectors first (deterministic, no model call)
      for (const sel of this.proven) {
        const v = validateSelector(html, sel, knownPrices, category);
        if (v.ok && v.price != null) {
          this.record({ url, selector: sel, price: v.price, outcome: canAdopt ? 'adopted' : 'shadow' });
          if (canAdopt) { this.stats.adopted++; return { price: v.price, selector: sel }; }
          return null;
        }
      }
      // 2) pending selectors: a pass here is check (e) — second page of the same store
      for (const sel of [...this.pending.keys()]) {
        const v = validateSelector(html, sel, knownPrices, category);
        if (v.ok && v.price != null) {
          this.pending.delete(sel); this.proven.add(sel); this.stats.proven++;
          this.record({ url, selector: sel, price: v.price, outcome: canAdopt ? 'adopted' : 'proven' });
          if (canAdopt) { this.stats.adopted++; return { price: v.price, selector: sel }; }
          return null;
        }
      }
      // 3) ask the model (capped, timed out, failure-isolated)
      if (!this.budget.tryConsume()) { this.record({ url, selector: null, price: null, outcome: 'cap' }); return null; }
      const proposer = this.opts.proposer ?? llamaCppProposer;
      const raw = await withTimeout(proposer(buildPrompt(html, url, title)), this.opts.timeoutMs ?? HEAL_LLM_TIMEOUT_MS);
      const sel = parseSelectorOutput(raw);
      if (!sel) { this.record({ url, selector: null, price: null, outcome: raw == null ? 'error' : 'no-proposal' }); return null; }
      this.stats.proposals++;
      const v = validateSelector(html, sel, knownPrices, category);
      if (!v.ok) { this.stats.rejected++; this.record({ url, selector: sel, price: null, outcome: 'rejected', failedCheck: v.failedCheck }); return null; }
      this.stats.validated++;
      this.pending.set(sel, url); // first success only — adoption still needs a second page (e)
      this.record({ url, selector: sel, price: v.price, outcome: 'shadow' });
      return null;
    } catch {
      this.record({ url, selector: null, price: null, outcome: 'error' });
      return null; // LLM heal must never break a hunt
    }
  }
}
