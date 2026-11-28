import { describe, expect, it } from 'vitest';
import { unchangedWindowMs } from '../src/config.ts';

const DAY = 86400_000;

describe('unchangedWindowMs', () => {
  it('defaults to 7 days when unset', () => {
    expect(unchangedWindowMs({})).toBe(7 * DAY);
  });
  it('defaults to 7 days when empty (scheduled runs pass an empty input)', () => {
    expect(unchangedWindowMs({ SAFQA_UNCHANGED_DAYS: '' })).toBe(7 * DAY);
  });
  it('allows explicit 0 = force re-send everything', () => {
    expect(unchangedWindowMs({ SAFQA_UNCHANGED_DAYS: '0' })).toBe(0);
  });
  it('honours positive overrides', () => {
    expect(unchangedWindowMs({ SAFQA_UNCHANGED_DAYS: '3' })).toBe(3 * DAY);
    expect(unchangedWindowMs({ SAFQA_UNCHANGED_DAYS: '14' })).toBe(14 * DAY);
  });
  it('falls back to 7 days on invalid or negative values', () => {
    expect(unchangedWindowMs({ SAFQA_UNCHANGED_DAYS: 'abc' })).toBe(7 * DAY);
    expect(unchangedWindowMs({ SAFQA_UNCHANGED_DAYS: '-1' })).toBe(7 * DAY);
  });
});
