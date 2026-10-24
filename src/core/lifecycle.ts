/**
 * Creating documents from other documents: duplicate, repeat next period,
 * convert a quote into an invoice, and credit an issued invoice. All return a
 * new draft with a fresh id and the next number in the right series.
 */
import { addMonths, dueDateFor, todayISO } from './dates.ts';
import { nextNumber } from './numbering.ts';
import { STATUSES_BY_TYPE, uid, type DocType, type InvoiceState } from './state.ts';

/** A new unissued draft copied from `src`, optionally changing its type. */
function draftFrom(src: InvoiceState, type: DocType, docs: InvoiceState[]): InvoiceState {
  const copy = structuredClone(src);
  copy.id = uid();
  copy.docType = type;
  copy.items = copy.items.map((it) => ({ ...it, id: uid() }));
  copy.meta.number = nextNumber(type, docs);
  copy.meta.status = STATUSES_BY_TYPE[type][0]!;
  copy.meta.issuedAt = null;
  copy.totals.amountPaid = 0;
  copy.updatedAt = Date.now();
  return copy;
}

/** Same content, new number, dated today. */
export function duplicateDoc(src: InvoiceState, docs: InvoiceState[]): InvoiceState {
  const copy = draftFrom(src, src.docType, docs);
  copy.ref = null;
  return redate(copy, todayISO());
}

/** Next billing period: every date moves forward by one month. */
export function repeatNextPeriod(src: InvoiceState, docs: InvoiceState[]): InvoiceState {
  const copy = draftFrom(src, src.docType, docs);
  copy.ref = null;
  const m = copy.meta;
  m.issueDate = addMonths(m.issueDate, 1);
  if (m.dueDate) m.dueDate = addMonths(m.dueDate, 1);
  if (m.supplyDate) m.supplyDate = addMonths(m.supplyDate, 1);
  if (m.validUntil) m.validUntil = addMonths(m.validUntil, 1);
  return copy;
}

/** An invoice built from an accepted quote. */
export function invoiceFromQuote(quote: InvoiceState, docs: InvoiceState[]): InvoiceState {
  const inv = draftFrom(quote, 'invoice', docs);
  inv.ref = { number: quote.meta.number, date: quote.meta.issueDate };
  return redate(inv, todayISO());
}

/** A credit note that reverses `invoice` in full (edit lines for a partial credit). */
export function creditNoteFor(invoice: InvoiceState, docs: InvoiceState[]): InvoiceState {
  const cn = draftFrom(invoice, 'credit', docs);
  cn.ref = { number: invoice.meta.number, date: invoice.meta.issueDate };
  cn.notes.notes = `This credit note cancels invoice #${invoice.meta.number}.`;
  cn.payment = { ...cn.payment, method: 'none' };
  return redate(cn, todayISO());
}

function redate(doc: InvoiceState, issueDate: string): InvoiceState {
  const m = doc.meta;
  m.issueDate = issueDate;
  m.supplySameAsIssue = true;
  m.supplyDate = '';
  if (m.dueTerm !== 'custom') m.dueDate = dueDateFor(issueDate, m.dueTerm) ?? issueDate;
  m.validUntil = addMonths(issueDate, 1);
  return doc;
}
