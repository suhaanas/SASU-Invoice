import { describe, expect, it } from 'vitest';
import { rangeFor } from '../src/dashboard/pages/Reports';

describe('report date presets', () => {
  it('handles month, quarter and year boundaries', () => {
    expect(rangeFor('this_month', '2026-10-24')).toEqual({ from: '2026-10-01', to: '2026-10-24' });
    expect(rangeFor('last_month', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(rangeFor('last_month', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(rangeFor('this_quarter', '2026-11-20')).toEqual({
      from: '2026-10-01',
      to: '2026-11-20',
    });
    expect(rangeFor('this_year', '2026-10-24')).toEqual({ from: '2026-01-01', to: '2026-10-24' });
    expect(rangeFor('last_12', '2026-10-24')).toEqual({ from: '2025-11-01', to: '2026-10-24' });
  });
});
