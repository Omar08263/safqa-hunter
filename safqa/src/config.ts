// Identity and politeness rules. These are not configurable on purpose.
export const UA = 'SafqaBot/5.0 (+https://safqaeg.pages.dev/about; price comparison; contact via site)';
export const UA_TOKEN = 'SafqaBot'; // the robots.txt group we obey (falls back to *)
export const MIN_DELAY_MS = 2500; // between requests to the same host, raised by Crawl-delay if larger
export const REFUSAL_STATUSES = new Set([401, 403]); // explicit refusal: stop that store for 24 h, never evade
export const THROTTLE_STATUSES = new Set([429, 503]); // "slow down" signals: stop this run, honour Retry-After
export const STOP_STATUSES = new Set([...REFUSAL_STATUSES, ...THROTTLE_STATUSES]); // union, kept for callers that only ask "stop?"
/** Graduated refusal cooldown ladder (hours): re-test sooner, back off harder only if refusal repeats. */
export const COOLDOWN_STEPS_H = [1, 3, 6, 12, 24];
export const cooldownMs = (refusalCount: number) => COOLDOWN_STEPS_H[Math.min(Math.max(refusalCount - 1, 0), COOLDOWN_STEPS_H.length - 1)]! * 3600_000;
export const API = process.env.SAFQA_API ?? 'https://safqa-api.safqaeg.workers.dev';
export const TOKEN = process.env.SAFQA_HUNTER_TOKEN ?? '';

// D1 write-budget discipline (2026-11-27: the daily budget was exhausted mid-day). All tunable by env,
// defaults chosen to cut hunter writes hard without losing price freshness that matters.
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
/**
 * Unchanged-refresh window in ms. Default 7 days. SAFQA_UNCHANGED_DAYS=0 is an explicit
 * operator override meaning "force re-send everything" (used after server-side store
 * registration so previously-rejected items are delivered immediately instead of waiting
 * out the window). Unset/empty/invalid/negative all fall back to the 7-day default.
 */
export function unchangedWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const v = env.SAFQA_UNCHANGED_DAYS;
  if (v === undefined || v === '') return 7 * 86400_000;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n * 86400_000 : 7 * 86400_000;
}
/** Re-send an unchanged item only after this window (refresh), measured from the last SEND, not last fetch. */
export const UNCHANGED_WINDOW_MS = unchangedWindowMs();
/**
 * Items per POST /api/v5/hunter/batch. CONTRACT: the Worker hard-caps every batch at
 * MAX_BATCH = 6 (apps/edge/src/catalog/hunter.ts in Omar08263/safqa) and silently drops the
 * rest — it does not error. Anything above 6 sent by the hunter is lost AND wrongly marked
 * "sent" locally (hunt.ts records sentAt after sink.add), so it would not be re-sent until
 * the 7-day unchanged window expired. The client must therefore never exceed 6: the default
 * is 6 and any SAFQA_BATCH override is clamped to [1, 6]. Pure function of env for testing.
 */
export const SERVER_MAX_BATCH = 6;
export function batchSize(env: NodeJS.ProcessEnv = process.env): number {
  const v = env.SAFQA_BATCH;
  if (v === undefined || v === '') return SERVER_MAX_BATCH;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return SERVER_MAX_BATCH;
  return Math.min(SERVER_MAX_BATCH, Math.max(1, Math.floor(n)));
}
export const BATCH_SIZE = batchSize();
/** Refuse to start a real hunt unless at least this many background rows remain today. */
export const MIN_ROOM = Math.floor(num(process.env.SAFQA_MIN_ROOM, 8000));
/** Below this remaining room the budget is "tight": skip getPlan/report (each costs reads/writes). */
export const TIGHT_ROOM = Math.floor(num(process.env.SAFQA_TIGHT_ROOM, MIN_ROOM * 2));
/** Max AI self-heal calls per store run. */
export const HEAL_CAP = Math.floor(num(process.env.SAFQA_HEAL_CAP, 50));

/** LLM heal layer (heal-llm.ts, OFF by default via SAFQA_HEAL_LLM): hard cap 30 model calls per
 *  hunt run across all stores, per-call timeout, local GGUF model + llama.cpp binary paths.
 *  Model and binary live in actions/cache — never in the repo. */
export const HEAL_LLM_CAP = Math.min(30, Math.floor(num(process.env.SAFQA_HEAL_LLM_CAP, 30)));
export const HEAL_LLM_TIMEOUT_MS = Math.floor(num(process.env.SAFQA_HEAL_LLM_TIMEOUT_MS, 30_000));
export const HEAL_LLM_MODEL = process.env.SAFQA_HEAL_LLM_MODEL ?? 'models/qwen3-1.7b-q4_k_m.gguf';
export const LLAMA_BIN = process.env.SAFQA_LLAMA_BIN ?? 'llama-cli';

/** Hard caps for the robots.txt sitemap fallback (2026-11-27: a refused store whose robots.txt
 *  declares dozens of sitemaps streamed them all and stretched a full hunt to ~31 min). The
 *  fallback reads at most this many sitemap files and collects at most this many product URLs;
 *  configured (primary) sitemaps are uncapped here and still respect SITEMAP_CACHE_MAX. */
export const ROBOTS_FALLBACK_MAX_FILES = Math.floor(num(process.env.SAFQA_ROBOTS_FALLBACK_FILES, 5));
export const ROBOTS_FALLBACK_MAX_URLS = Math.floor(num(process.env.SAFQA_ROBOTS_FALLBACK_URLS, 20_000));
