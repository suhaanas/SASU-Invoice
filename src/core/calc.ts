/**
 * Invoice totals, computed entirely in integer minor units.
 *
 * Order: line amounts → subtotal → discount → tax (on discounted lines, per
 * line rate or invoice rate) → + shipping (untaxed) → total → − paid → balance.
 */
import { roundHalfUp, toMinor } from './money';
import type { InvoiceState } from './state';

export interface LineResult {
  id: string;
  qty: number;
  rateMinor: number;
  amountMinor: number;
  taxRate: number;
}

export interface TaxLine {
  rate: number;
  amountMinor: number;
}

export interface Totals {
  lines: LineResult[];
  subtotal: number;
  discount: number;
  /** Discount as a %, for labels ("Discount (10%)"); null when fixed. */
  discountPct: number | null;
  taxes: TaxLine[];
  tax: number;
  shipping: number;
  total: number;
  paid: number;
  balance: number;
}

const clampNonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function computeTotals(state: InvoiceState): Totals {
  const cur = state.meta.currency;
  const t = state.totals;
  const invoiceTax = clampNonNeg(t.taxRate);

  const lines: LineResult[] = state.items.map((item) => {
    const qty = clampNonNeg(item.qty);
    const rateMinor = toMinor(clampNonNeg(item.rate), cur);
    return {
      id: item.id,
      qty,
      rateMinor,
      amountMinor: roundHalfUp(qty * rateMinor),
      taxRate: item.taxRate === null ? invoiceTax : clampNonNeg(item.taxRate),
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.amountMinor, 0);

  let discount: number;
  let discountPct: number | null = null;
  if (t.discountType === 'percent') {
    discountPct = Math.min(100, clampNonNeg(t.discountValue));
    discount = roundHalfUp((subtotal * discountPct) / 100);
  } else {
    discount = Math.min(subtotal, toMinor(clampNonNeg(t.discountValue), cur));
  }

  // Allocate the discount across lines pro rata so each line is taxed on its
  // net amount; the last non-zero line absorbs the rounding remainder.
  const taxByRate = new Map<number, number>();
  let allocated = 0;
  const lastIdx = lines.findLastIndex((l) => l.amountMinor > 0);
  lines.forEach((l, i) => {
    if (l.amountMinor === 0) return;
    const share =
      i === lastIdx ? discount - allocated : roundHalfUp((discount * l.amountMinor) / subtotal);
    allocated += share;
    if (l.taxRate === 0) return;
    const net = l.amountMinor - share;
    taxByRate.set(l.taxRate, (taxByRate.get(l.taxRate) ?? 0) + (net * l.taxRate) / 100);
  });

  const taxes: TaxLine[] = [...taxByRate.entries()]
    .map(([rate, raw]) => ({ rate, amountMinor: roundHalfUp(raw) }))
    .filter((x) => x.amountMinor !== 0)
    .sort((a, b) => b.rate - a.rate);
  const tax = taxes.reduce((s, x) => s + x.amountMinor, 0);

  const shipping = toMinor(clampNonNeg(t.shipping), cur);
  const total = subtotal - discount + tax + shipping;
  const paid = Math.min(total, toMinor(clampNonNeg(t.amountPaid), cur));

  return {
    lines,
    subtotal,
    discount,
    discountPct,
    taxes,
    tax,
    shipping,
    total,
    paid,
    balance: total - paid,
  };
}
