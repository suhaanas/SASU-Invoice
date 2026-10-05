/**
 * CSV export for accountants: one row per line item, invoice columns repeated.
 * Amounts are plain decimals (no currency symbol or grouping).
 */
import { computeTotals } from './calc';
import { currencyDigits, fromMinor } from './money';
import { supplyDate, type InvoiceState } from './state';

/**
 * Quote a CSV field (RFC 4180) and neutralise spreadsheet formulas: a cell
 * starting with = + - @ tab or CR is prefixed with ' so Excel/Sheets treat it
 * as text (CSV injection, OWASP).
 */
export function csvField(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: (string | number)[][]): string =>
  rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';

const HEADER = [
  'document_type', 'number', 'status', 'issue_date', 'supply_date', 'due_date',
  'client_name', 'client_company', 'client_tax_id', 'currency',
  'line_no', 'description', 'quantity', 'unit', 'unit_price', 'vat_category', 'vat_rate', 'line_amount',
  'doc_subtotal', 'doc_discount', 'doc_tax', 'doc_total', 'doc_paid', 'doc_balance',
];

export function documentsToCsv(docs: InvoiceState[]): string {
  const rows: (string | number)[][] = [HEADER];
  for (const d of docs) {
    const t = computeTotals(d);
    const cur = d.meta.currency;
    const amt = (minor: number) => fromMinor(minor, cur).toFixed(currencyDigits(cur));
    const head = [
      d.docType, d.meta.number, d.meta.status, d.meta.issueDate, supplyDate(d), d.meta.dueDate,
      d.client.name, d.client.company, d.client.taxId, cur,
    ];
    const tail = [amt(t.subtotal), amt(t.discount), amt(t.tax), amt(t.total), amt(t.paid), amt(t.balance)];
    const lines = d.items.length ? d.items : [];
    if (lines.length === 0) rows.push([...head, '', '', '', '', '', '', '', '', ...tail]);
    lines.forEach((item, i) => {
      const l = t.lines[i];
      rows.push([
        ...head,
        i + 1, item.desc, l?.qty ?? 0, item.unit, amt(l?.rateMinor ?? 0), item.vatCategory, l?.taxRate ?? 0,
        amt(l?.amountMinor ?? 0),
        ...tail,
      ]);
    });
  }
  return toCsv(rows);
}
