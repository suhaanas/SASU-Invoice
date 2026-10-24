// GENERATED from src/core by scripts/sync-functions-core.mjs. Do not edit.
/**
 * Invoice totals, computed entirely in integer minor units.
 *
 * Order: line amounts → subtotal → discount → tax (on discounted lines, per
 * line rate or invoice rate) → + shipping (untaxed) → total → − paid → balance.
 */
import { roundHalfUp, toMinor } from './money.ts';
import type { InvoiceState, VatCategory } from './state.ts';

export interface LineResult {
  id: string;
  qty: number;
  rateMinor: number;
  amountMinor: number;
  taxRate: number;
  vatCategory: VatCategory;
}

/** One row of the VAT breakdown: category, rate, taxable base and tax. */
export interface TaxLine {
  category: VatCategory;
  rate: number;
  /** Net amount (after its share of the discount) taxed at this rate. */
  baseMinor: number;
  amountMinor: number;
}

/** Categories that never carry VAT on this invoice (rate is forced to 0). */
const ZERO_CATEGORIES: ReadonlySet<VatCategory> = new Set(['Z', 'E', 'AE', 'K', 'G', 'O']);

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
      taxRate: ZERO_CATEGORIES.has(item.vatCategory)
        ? 0
        : item.taxRate === null
          ? invoiceTax
          : clampNonNeg(item.taxRate),
      vatCategory: item.vatCategory,
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
  const groups = new Map<string, { category: VatCategory; rate: number; base: number; raw: number }>();
  let allocated = 0;
  const lastIdx = lines.findLastIndex((l) => l.amountMinor > 0);
  lines.forEach((l, i) => {
    if (l.amountMinor === 0) return;
    const share =
      i === lastIdx ? discount - allocated : roundHalfUp((discount * l.amountMinor) / subtotal);
    allocated += share;
    const net = l.amountMinor - share;
    const key = `${l.vatCategory}|${l.taxRate}`;
    const g = groups.get(key) ?? { category: l.vatCategory, rate: l.taxRate, base: 0, raw: 0 };
    g.base += net;
    g.raw += (net * l.taxRate) / 100;
    groups.set(key, g);
  });

  // Standard-rate groups at 0% carry no information; everything else (incl.
  // exempt / reverse-charge bases) is part of a legally complete breakdown.
  const taxes: TaxLine[] = [...groups.values()]
    .map((g) => ({ category: g.category, rate: g.rate, baseMinor: g.base, amountMinor: roundHalfUp(g.raw) }))
    .filter((x) => x.category !== 'S' || x.rate !== 0)
    .sort((a, b) => b.rate - a.rate || a.category.localeCompare(b.category));
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
