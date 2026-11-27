// Manual bench for the LLM heal layer (NOT part of CI): runs the real llama.cpp proposer in
// shadow mode over failure-page fixtures (no JSON-LD/OG/microdata, price in non-standard
// classes — the shape deterministic layers miss) and measures proposal accuracy.
// Usage: SAFQA_HEAL_LLM=shadow SAFQA_LLAMA_BIN=... SAFQA_HEAL_LLM_MODEL=... npx tsx scripts/heal-llm-bench.ts [--dir <html-dir>]
// With --dir, every *.html in the dir is also benched (expected price unknown → proposals only).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { HealLlmBudget, HealLlmSession, llamaCppProposer } from '../src/heal-llm.ts';

// Debug wrapper: log the model's raw output (truncated) so a no-proposal is diagnosable.
const debugProposer = async (prompt: string) => {
  const raw = await llamaCppProposer(prompt);
  console.log(JSON.stringify({ raw: (raw ?? '').slice(-600) }));
  return raw;
};

interface Fixture { name: string; html: string; expected: number | null; url: string }
const wrap = (title: string, body: string) => `<html><head><title>${title}</title></head><body><header>متجر</header><main><h1>${title}</h1>${body}</main><footer>©</footer></body></html>`;

// Two pages per template: check (e) needs the same selector to pass on a second page.
const fixtures: Fixture[] = [
  { name: 'tpl-a/1', url: 'https://bench.example/a/1', expected: 18999, html: wrap('Galaxy A55', `<div class="buy-box"><del class="was">21,999 جنيه</del><span class="final-cost">18,999 جنيه</span><p class="inst">أو 1,583 جنيه × 12 شهر</p></div>`) },
  { name: 'tpl-a/2', url: 'https://bench.example/a/2', expected: 21499, html: wrap('Galaxy A35', `<div class="buy-box"><del class="was">24,999 جنيه</del><span class="final-cost">21,499 جنيه</span><p class="inst">أو 1,792 جنيه × 12 شهر</p></div>`) },
  { name: 'tpl-b/1', url: 'https://bench.example/b/1', expected: 45900, html: wrap('HP Victus 15', `<section class="offer"><div class="amount-now">EGP 45,900</div><div class="ship">شحن 60 جنيه</div></section>`) },
  { name: 'tpl-b/2', url: 'https://bench.example/b/2', expected: 38900, html: wrap('Lenovo LOQ', `<section class="offer"><div class="amount-now">EGP 38,900</div><div class="ship">شحن 60 جنيه</div></section>`) },
  { name: 'tpl-c/1', url: 'https://bench.example/c/1', expected: 7499, html: wrap('سماعات سوني', `<div class="cta"><strong class="قيمة-الشراء">٧٬٤٩٩ ج.م</strong><span class="rating">4.8 (120)</span></div>`) },
  { name: 'tpl-c/2', url: 'https://bench.example/c/2', expected: 8999, html: wrap('سماعات بوز', `<div class="cta"><strong class="قيمة-الشراء">٨٬٩٩٩ ج.م</strong><span class="rating">4.9 (98)</span></div>`) },
];

const dirArg = process.argv.indexOf('--dir');
if (dirArg > 0 && process.argv[dirArg + 1]) {
  for (const f of readdirSync(process.argv[dirArg + 1]!).filter((x) => x.endsWith('.html')).slice(0, 24)) {
    fixtures.push({ name: `real/${f}`, url: `https://bench.example/real/${f}`, expected: null, html: readFileSync(`${process.argv[dirArg + 1]}/${f}`, 'utf8') });
  }
}

const budget = new HealLlmBudget();
const sessions = new Map<string, HealLlmSession>();
const results: { name: string; expected: number | null; outcome?: string; price?: number | null; selector?: string | null; correct?: boolean }[] = [];
for (const fx of fixtures) {
  const store = fx.name.split('/')[0]!;
  const session = sessions.get(store) ?? new HealLlmSession(store, { budget, proposer: debugProposer });
  sessions.set(store, session);
  const before = session.summary().records.length;
  await session.tryHeal(fx.html, fx.url, []); // shadow: never adopts; records carry the verdict
  const rec = session.summary().records[before];
  results.push({ name: fx.name, expected: fx.expected, outcome: rec?.outcome, price: rec?.price, selector: rec?.selector, correct: fx.expected != null && rec?.price === fx.expected });
  console.log(JSON.stringify(results.at(-1)));
}
const scored = results.filter((r) => r.expected != null);
const summary = {
  at: new Date().toISOString(), pages: results.length, modelCalls: budget.calls,
  proposals: results.filter((r) => r.selector).length,
  validated: results.filter((r) => r.outcome === 'shadow' || r.outcome === 'proven').length,
  proven: results.filter((r) => r.outcome === 'proven').length,
  correct: scored.filter((r) => r.correct).length, scored: scored.length,
  accuracy: scored.length ? scored.filter((r) => r.correct).length / scored.length : null,
  results,
};
mkdirSync('out', { recursive: true });
writeFileSync('out/heal-llm-bench.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, results: undefined }));
