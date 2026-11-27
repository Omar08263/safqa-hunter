// Adaptive priority scheduler: what to fetch first within a store's page budget.
//  1. products people watch / that are hot (plan from the Safqa API), stalest first
//  2. URLs that are new in the sitemap (new arrivals)
//  3. everything else, least recently fetched first; recently changed pages come back sooner
// Known URLs are also tiered A/B/C/D by measured change velocity (from state: how often the
// sent fingerprint actually changed): A = fast movers (recheck first), D = chronic failures.
import type { UrlState } from './state.ts';

export type Tier = 'A' | 'B' | 'C' | 'D';
const DAY = 86400_000;
/** Change-velocity tier for a known URL. A: changed >=3 times or >=1 change/day; B: changed at
 *  least once; C: seen, never changed; D: failing repeatedly (back off hardest). */
export function classifyTier(s: UrlState, now = Date.now()): Tier {
  if ((s.fails ?? 0) >= 3) return 'D';
  const changes = s.changes ?? 0;
  const ageDays = Math.max(1, (now - (s.first || now)) / DAY);
  if (changes >= 3 || changes / ageDays >= 1) return 'A';
  if (changes >= 1) return 'B';
  return 'C';
}
const TIER_RANK: Record<Tier, number> = { A: 0, B: 1, C: 2, D: 3 };

export interface PlanRow { url: string; heat: number; checked_at: string | null; watchers: number }
export function prioritise(all: string[], seen: Record<string, UrlState>, plan: PlanRow[], budget: number, now = Date.now(), lastmods: Record<string, string> = {}): string[] {
  const H = 3600_000;
  const out: string[] = []; const used = new Set<string>();
  const push = (u: string) => { if (!used.has(u) && out.length < budget) { used.add(u); out.push(u); } };
  const inMap = new Set(all);
  // 1. watched/hot, if due (watched 6 h, hot 12 h; the Worker already rechecks the very hottest hourly)
  for (const p of plan) {
    const age = p.checked_at ? now - Date.parse(p.checked_at) : Infinity;
    const due = p.watchers > 0 ? 6 * H : p.heat >= 30 ? 12 * H : 48 * H;
    if (age >= due && (inMap.has(p.url) || !all.length)) push(p.url);
  }
  // 2. new arrivals: up to 70% of the remaining budget
  const fresh = all.filter((u) => !seen[u]);
  const freshCap = out.length + Math.ceil((budget - out.length) * 0.7);
  for (const u of fresh) { if (out.length >= freshCap) break; push(u); }
  // 3. known URLs whose sitemap lastmod is newer than our last fetch (changed since we saw them) first,
  //    then by change-velocity tier (A fast movers first, D chronic failures last), then stalest first
  const changed = (u: string) => { const lm = lastmods[u] ? Date.parse(lastmods[u]) : NaN; return !Number.isNaN(lm) && lm > (seen[u]?.last ?? 0); };
  const known = all.filter((u) => seen[u]).sort((a, b) => {
    if (changed(a) !== changed(b)) return changed(a) ? -1 : 1;
    const t = TIER_RANK[classifyTier(seen[a]!, now)] - TIER_RANK[classifyTier(seen[b]!, now)];
    return t !== 0 ? t : score(seen[a]!) - score(seen[b]!);
  });
  for (const u of known) push(u);
  return out;
  function score(s: UrlState) { return (s.last ?? 0) + (s.fails ?? 0) * 24 * H; }
}
