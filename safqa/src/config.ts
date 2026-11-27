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
/** Re-send an unchanged item only after this window (refresh), measured from the last SEND, not last fetch. */
export const UNCHANGED_WINDOW_MS = num(process.env.SAFQA_UNCHANGED_DAYS, 7) * 86400_000;
/** Items per POST /api/v5/hunter/batch. Fewer, larger batches = fewer requests for the same rows. */
export const BATCH_SIZE = Math.floor(num(process.env.SAFQA_BATCH, 25));
/** Refuse to start a real hunt unless at least this many background rows remain today. */
export const MIN_ROOM = Math.floor(num(process.env.SAFQA_MIN_ROOM, 8000));
/** Below this remaining room the budget is "tight": skip getPlan/report (each costs reads/writes). */
export const TIGHT_ROOM = Math.floor(num(process.env.SAFQA_TIGHT_ROOM, MIN_ROOM * 2));
/** Max AI self-heal calls per store run. */
export const HEAL_CAP = Math.floor(num(process.env.SAFQA_HEAL_CAP, 50));

/** Hard caps for the robots.txt sitemap fallback (2026-11-27: a refused store whose robots.txt
 *  declares dozens of sitemaps streamed them all and stretched a full hunt to ~31 min). The
 *  fallback reads at most this many sitemap files and collects at most this many product URLs;
 *  configured (primary) sitemaps are uncapped here and still respect SITEMAP_CACHE_MAX. */
export const ROBOTS_FALLBACK_MAX_FILES = Math.floor(num(process.env.SAFQA_ROBOTS_FALLBACK_FILES, 5));
export const ROBOTS_FALLBACK_MAX_URLS = Math.floor(num(process.env.SAFQA_ROBOTS_FALLBACK_URLS, 20_000));
