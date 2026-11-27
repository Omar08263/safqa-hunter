// Resilience for the work that happens OUTSIDE Crawlee (which has its own retries/pool):
// a cockatiel circuit breaker per store around API calls (heal), plus p-limit/p-throttle
// discipline so heal calls never burst. A tripped breaker fails fast and locally —
// the store's crawl continues, only the optional heal step is skipped.
import { circuitBreaker, ConsecutiveBreaker, handleAll, BrokenCircuitError } from 'cockatiel';
import pLimit from 'p-limit';
import pThrottle from 'p-throttle';

export interface StoreBreaker {
  execute<T>(fn: () => Promise<T>): Promise<T | null>;
  readonly state: string;
}

const breakers = new Map<string, ReturnType<typeof circuitBreaker>>();

function breakerFor(store: string) {
  let b = breakers.get(store);
  if (!b) {
    b = circuitBreaker(handleAll, {
      halfOpenAfter: 60_000, // probe again after a minute
      breaker: new ConsecutiveBreaker(5), // 5 consecutive failures trip it
    });
    breakers.set(store, b);
  }
  return b;
}

/** Run fn behind the store's breaker; returns null (never throws) when the breaker is open or fn fails. */
export async function guarded<T>(store: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await breakerFor(store).execute(fn);
  } catch (e) {
    if (e instanceof BrokenCircuitError) return null;
    return null;
  }
}

export const breakerState = (store: string) => breakerFor(store).state;

/** At most 2 heal calls in flight, started at most 1/second — heal is a courtesy, not the mission. */
const healLimit = pLimit(2);
const healThrottle = pThrottle({ limit: 1, interval: 1000 });
export const throttledHeal = <T>(fn: () => Promise<T>): Promise<T> => healLimit(() => healThrottle(fn)());

/** Bounded parallelism for store-level fan-out outside Crawlee. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const run = pLimit(limit);
  return Promise.all(items.map((it) => run(() => fn(it))));
}
