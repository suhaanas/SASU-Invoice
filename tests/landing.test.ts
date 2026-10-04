import { describe, expect, it } from 'vitest';
import { computeTotals } from '../src/core/calc';
import { parseInvoice } from '../src/core/validate';
import { featureInvoice, heroInvoice, heroInvoiceComplete } from '../src/landing/demo-data';

describe('landing demo data', () => {
  it('is valid against the real invoice schema, so demos never drift from the app', () => {
    for (const inv of [heroInvoice(), heroInvoiceComplete(), featureInvoice()]) {
      expect(parseInvoice(inv)).not.toBeNull();
    }
  });

  it('adds up the hero invoice correctly (£4,185 + 20% VAT)', () => {
    const t = computeTotals(heroInvoiceComplete());
    expect(t.subtotal).toBe(418500);
    expect(t.tax).toBe(83700);
    expect(t.total).toBe(502200);
  });
});
