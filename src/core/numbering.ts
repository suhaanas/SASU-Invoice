/**
 * Document numbering: one series per document type (INV-, QUO-, CN-, …).
 * Invoices must be numbered sequentially and uniquely, so the next number is
 * derived from the highest existing number in the same series.
 */
import { nextInvoiceNumber, type DocType, type InvoiceState } from './state';

export const SERIES_PREFIX: Record<DocType, string> = {
  invoice: 'INV-',
  quote: 'QUO-',
  credit: 'CN-',
  receipt: 'RCT-',
  proforma: 'PRO-',
};

/** Trailing integer of a number like "INV-0042" (or -1 if none). */
function seq(number: string): number {
  const m = /(\d+)\D*$/.exec(number);
  return m ? Number(m[1]) : -1;
}

/** Next number in a document type's series, e.g. "INV-007" after "INV-006". */
export function nextNumber(type: DocType, docs: InvoiceState[], excludeId?: string): string {
  const same = docs.filter((d) => d.docType === type && d.id !== excludeId && d.meta.number.trim());
  if (same.length === 0) return `${SERIES_PREFIX[type]}001`;
  const highest = same.reduce((best, d) => (seq(d.meta.number) > seq(best.meta.number) ? d : best));
  return nextInvoiceNumber(highest.meta.number);
}

/** Another document of the same type already using this number, if any. */
export function findDuplicate(doc: InvoiceState, docs: InvoiceState[]): InvoiceState | undefined {
  const n = doc.meta.number.trim().toLowerCase();
  if (!n) return undefined;
  return docs.find(
    (d) => d.id !== doc.id && d.docType === doc.docType && d.meta.number.trim().toLowerCase() === n,
  );
}
