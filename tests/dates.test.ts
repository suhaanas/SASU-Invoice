// Run west of UTC, where `new Date('YYYY-MM-DD')` would show the previous day.
process.env.TZ = 'America/Los_Angeles';

import { describe, expect, it } from 'vitest';
import { addDays, dueDateFor, formatDate, parseISODate, toISODate } from '../src/core/dates';

describe('dates', () => {
  it('parses ISO dates as local calendar dates (no off-by-one)', () => {
    const d = parseISODate('2026-10-05')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(5);
    expect(formatDate('2026-10-05', 'en-US')).toBe('Oct 5, 2026');
  });

  it('rejects invalid dates', () => {
    expect(parseISODate('2026-02-31')).toBeNull();
    expect(parseISODate('not a date')).toBeNull();
    expect(formatDate('', 'en-US')).toBe('');
  });

  it('round-trips and adds days across month/DST boundaries', () => {
    expect(toISODate(parseISODate('2026-03-08')!)).toBe('2026-03-08');
    expect(addDays('2026-10-05', 30)).toBe('2026-11-04');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('computes due dates from terms', () => {
    expect(dueDateFor('2026-10-05', 'net15')).toBe('2026-10-20');
    expect(dueDateFor('2026-10-05', 'receipt')).toBe('2026-10-05');
    expect(dueDateFor('2026-10-05', 'custom')).toBeNull();
  });
});
