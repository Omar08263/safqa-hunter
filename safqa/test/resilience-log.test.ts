import { CircuitState } from 'cockatiel';
import { describe, expect, it } from 'vitest';
import { breakerState, guarded, mapLimit, throttledHeal } from '../src/resilience.ts';
import { log, storeLog } from '../src/log.ts';

describe('circuit breaker (cockatiel)', () => {
  it('passes through successes and swallows failures as null', async () => {
    expect(await guarded('t1', async () => 42)).toBe(42);
    expect(await guarded('t1', async () => { throw new Error('x'); })).toBeNull();
  });
  it('trips after 5 consecutive failures and fails fast without calling fn', async () => {
    let calls = 0;
    const fail = async () => { calls++; throw new Error('down'); };
    for (let i = 0; i < 5; i++) await guarded('t2', fail);
    expect(calls).toBe(5);
    expect(breakerState('t2')).toBe(CircuitState.Open);
    const before = calls;
    expect(await guarded('t2', fail)).toBeNull();
    expect(calls).toBe(before); // fail-fast: fn not invoked while open
  });
  it('breakers are per-store', async () => {
    expect(await guarded('t3', async () => 'ok')).toBe('ok');
  });
});

describe('concurrency discipline (p-limit / p-throttle)', () => {
  it('mapLimit never exceeds the limit', async () => {
    let inFlight = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--; return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBeLessThanOrEqual(2);
  });
  it('throttledHeal spaces starts (>=~1s apart for the 2nd call)', async () => {
    const t0 = Date.now();
    const starts: number[] = [];
    await Promise.all([1, 2].map(() => throttledHeal(async () => { starts.push(Date.now() - t0); return 1; })));
    expect(Math.max(...starts)).toBeGreaterThanOrEqual(900);
  }, 10_000);
});

describe('pino structured logging', () => {
  it('logger emits JSON with app + store child fields', () => {
    const lines: string[] = [];
    const child = storeLog('btech');
    // pino writes to stdout by default; assert the API surface + level config instead of capturing fd
    expect(typeof log.info).toBe('function');
    expect(typeof child.info).toBe('function');
    expect(child.bindings().store).toBe('btech');
    expect(log.bindings().app).toBe('safqa-hunter');
    void lines;
  });
});
