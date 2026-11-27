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
