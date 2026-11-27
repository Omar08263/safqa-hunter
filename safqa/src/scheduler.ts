// Adaptive priority scheduler: what to fetch first within a store's page budget.
//  1. products people watch / that are hot (plan from the Safqa API), stalest first
//  2. URLs that are new in the sitemap (new arrivals)
//  3. everything else, least recently fetched first; recently changed pages come back sooner
import type { UrlState } from './state.ts';

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
  //    then stalest known URLs; failing ones back off
  const changed = (u: string) => { const lm = lastmods[u] ? Date.parse(lastmods[u]) : NaN; return !Number.isNaN(lm) && lm > (seen[u]?.last ?? 0); };
  const known = all.filter((u) => seen[u]).sort((a, b) => (changed(a) === changed(b) ? score(seen[a]!) - score(seen[b]!) : changed(a) ? -1 : 1));
  for (const u of known) push(u);
  return out;
  function score(s: UrlState) { return (s.last ?? 0) + (s.fails ?? 0) * 24 * H; }
}
