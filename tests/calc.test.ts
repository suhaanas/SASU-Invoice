import { describe, expect, it } from 'vitest';
import { computeTotals } from '../src/core/calc';
import { blankItem, createInvoice, type InvoiceState, type LineItem } from '../src/core/state';

function inv(items: Partial<LineItem>[], totals: Partial<InvoiceState['totals']> = {}, currency: InvoiceState['meta']['currency'] = 'USD'): InvoiceState {
  const s = createInvoice();
  s.meta.currency = currency;
  s.items = items.map((i) => ({ ...blankItem(), ...i }));
  s.totals = { ...s.totals, ...totals };
  return s;
}

describe('computeTotals', () => {
  it('sums lines in minor units without float drift', () => {
    const t = computeTotals(inv([{ qty: 3, rate: 0.1 }, { qty: 1, rate: 0.2 }]));
    expect(t.subtotal).toBe(50);
    expect(t.total).toBe(50);
  });

  it('applies percent discount before tax, then adds untaxed shipping', () => {
    const t = computeTotals(inv([{ qty: 2, rate: 50 }], { discountType: 'percent', discountValue: 10, taxRate: 20, shipping: 5 }));
    expect(t.subtotal).toBe(10000);
    expect(t.discount).toBe(1000);
    expect(t.tax).toBe(1800);
    expect(t.shipping).toBe(500);
    expect(t.total).toBe(10000 - 1000 + 1800 + 500);
  });

  it('caps a fixed discount at the subtotal', () => {
    const t = computeTotals(inv([{ qty: 1, rate: 30 }], { discountType: 'fixed', discountValue: 50 }));
    expect(t.discount).toBe(3000);
    expect(t.total).toBe(0);
  });

  it('supports per-line tax rates and groups tax by rate', () => {
    const t = computeTotals(
      inv([{ qty: 1, rate: 100, taxRate: 20 }, { qty: 1, rate: 100, taxRate: 5.5 }, { qty: 1, rate: 100 }], { taxRate: 10 }),
    );
    expect(t.taxes).toEqual([
      { category: 'S', rate: 20, baseMinor: 10000, amountMinor: 2000 },
      { category: 'S', rate: 10, baseMinor: 10000, amountMinor: 1000 },
      { category: 'S', rate: 5.5, baseMinor: 10000, amountMinor: 550 },
    ]);
    expect(t.tax).toBe(3550);
  });

  it('allocates discount across lines so the sum of shares equals the discount', () => {
    const t = computeTotals(
      inv([{ qty: 1, rate: 33.33, taxRate: 10 }, { qty: 1, rate: 33.33, taxRate: 10 }, { qty: 1, rate: 33.34, taxRate: 10 }], {
        discountType: 'fixed',
        discountValue: 10,
      }),
    );
    expect(t.discount).toBe(1000);
    // Net 90.00 at 10% = 9.00 exactly.
    expect(t.tax).toBe(900);
  });

  it('computes amount paid and balance due', () => {
    const t = computeTotals(inv([{ qty: 1, rate: 200 }], { amountPaid: 50 }));
    expect(t.paid).toBe(5000);
    expect(t.balance).toBe(15000);
    const over = computeTotals(inv([{ qty: 1, rate: 200 }], { amountPaid: 500 }));
    expect(over.balance).toBe(0);
  });

  it('handles JPY (0 decimals) and ignores negative/NaN input', () => {
    const t = computeTotals(inv([{ qty: 3, rate: 333.5 }, { qty: -1, rate: 100 }, { qty: Number.NaN, rate: 5 }], {}, 'JPY'));
    expect(t.lines[0]!.rateMinor).toBe(334);
    expect(t.subtotal).toBe(1002);
  });

  it('forces 0% for exempt / reverse-charge lines but keeps them in the breakdown', () => {
    const t = computeTotals(
      inv([{ qty: 1, rate: 100 }, { qty: 2, rate: 50, vatCategory: 'AE', taxRate: 20 }, { qty: 1, rate: 40, vatCategory: 'E' }], { taxRate: 20 }),
    );
    expect(t.tax).toBe(2000);
    expect(t.taxes).toEqual([
      { category: 'S', rate: 20, baseMinor: 10000, amountMinor: 2000 },
      { category: 'AE', rate: 0, baseMinor: 10000, amountMinor: 0 },
      { category: 'E', rate: 0, baseMinor: 4000, amountMinor: 0 },
    ]);
  });
});
