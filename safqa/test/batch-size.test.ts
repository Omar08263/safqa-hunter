import { describe, expect, it } from 'vitest';
import { batchSize, SERVER_MAX_BATCH } from '../src/config.ts';

// Regression (contract drift, found 2026-11-28): the hunter defaulted to BATCH 25 while the
// Worker silently truncates every /api/v5/hunter/batch payload to MAX_BATCH = 6. Items 7-25
// of every batch were dropped server-side but marked "sent" in hunter state, so they were
// never delivered until the 7-day unchanged window expired. The client must never exceed 6.
describe('batchSize — hunter batch must never exceed the server MAX_BATCH contract', () => {
  it('defaults to the server cap (6) when unset', () => {
    expect(batchSize({})).toBe(SERVER_MAX_BATCH);
    expect(batchSize({})).toBe(6);
  });
  it('defaults to the server cap when empty (scheduled runs pass empty inputs)', () => {
    expect(batchSize({ SAFQA_BATCH: '' })).toBe(6);
  });
  it('falls back to the server cap on zero, negative or invalid values', () => {
    expect(batchSize({ SAFQA_BATCH: '0' })).toBe(6);
    expect(batchSize({ SAFQA_BATCH: '-3' })).toBe(6);
    expect(batchSize({ SAFQA_BATCH: 'abc' })).toBe(6);
  });
  it('honours smaller positive overrides', () => {
    expect(batchSize({ SAFQA_BATCH: '1' })).toBe(1);
    expect(batchSize({ SAFQA_BATCH: '3' })).toBe(3);
    expect(batchSize({ SAFQA_BATCH: '6' })).toBe(6);
  });
  it('clamps any override above the server cap (BUG: 25 silently lost 19 items per batch)', () => {
    expect(batchSize({ SAFQA_BATCH: '7' })).toBe(6);
    expect(batchSize({ SAFQA_BATCH: '25' })).toBe(6);
    expect(batchSize({ SAFQA_BATCH: '1000' })).toBe(6);
  });
  it('floors fractional values', () => {
    expect(batchSize({ SAFQA_BATCH: '2.9' })).toBe(2);
  });
});
