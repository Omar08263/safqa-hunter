// Identity and politeness rules. These are not configurable on purpose.
export const UA = 'SafqaBot/5.0 (+https://safqaeg.pages.dev/about; price comparison; contact via site)';
export const UA_TOKEN = 'SafqaBot'; // the robots.txt group we obey (falls back to *)
export const MIN_DELAY_MS = 2500; // between requests to the same host, raised by Crawl-delay if larger
export const STOP_STATUSES = new Set([401, 403, 429, 503]); // the site is refusing us: stop that store for this run
export const API = process.env.SAFQA_API ?? 'https://safqa-api.safqaeg.workers.dev';
export const TOKEN = process.env.SAFQA_HUNTER_TOKEN ?? '';
