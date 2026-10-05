/**
 * Pure invoice-sheet builder shared by the editor preview and the landing
 * page demos. Builds DOM with textContent only; line breaks come from CSS
 * `white-space: pre-wrap`. Regions carry `data-region` so callers can
 * highlight parts of the sheet.
 */
import type { Totals } from '../core/calc';
import { formatDate } from '../core/dates';
import { formatMoney, formatNumber } from '../core/money';
import { effectiveStatus, type InvoiceState } from '../core/state';
import { el } from './dom';

export interface TotalRow {
  label: string;
  value: string;
  kind?: 'discount' | 'grand' | 'balance';
}

/** Totals rows shared by the sheet, the summary panel and the PDF. */
export function totalRows(state: InvoiceState, t: Totals): TotalRow[] {
  const { currency, locale } = state.meta;
  const m = (minor: number) => formatMoney(minor, currency, locale);
  const rows: TotalRow[] = [{ label: 'Subtotal', value: m(t.subtotal) }];
  if (t.discount > 0) {
    const pct = t.discountPct !== null ? ` (${formatNumber(t.discountPct, locale)}%)` : '';
    rows.push({ label: `Discount${pct}`, value: `−${m(t.discount)}`, kind: 'discount' });
  }
  const taxLabel = state.totals.taxLabel.trim() || 'Tax';
  for (const tx of t.taxes.filter((x) => x.amountMinor !== 0)) {
    rows.push({ label: `${taxLabel} (${formatNumber(tx.rate, locale, 3)}%)`, value: m(tx.amountMinor) });
  }
  if (t.shipping > 0) rows.push({ label: 'Shipping', value: m(t.shipping) });
  rows.push({ label: 'Total', value: m(t.total), kind: 'grand' });
  if (t.paid > 0) {
    rows.push({ label: 'Amount Paid', value: `−${m(t.paid)}` });
    rows.push({ label: 'Balance Due', value: m(t.balance), kind: 'balance' });
  }
  return rows;
}

/** A text paragraph that is omitted when empty. */
function p(cls: string, text: string): HTMLParagraphElement | null {
  return text.trim() ? el('p', { class: cls, text }) : null;
}

/** Contact parts as nowrap spans so lines only break between parts. */
function parts(cls: string, values: string[]): HTMLParagraphElement | null {
  const clean = values.map((v) => v.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  return el(
    'p',
    { class: cls },
    clean.flatMap((v, i) => [i > 0 ? ' • ' : null, el('span', { class: 'contact-part', text: v })]),
  );
}

export function buildSheet(state: InvoiceState, totals: Totals): HTMLElement {
  const { business: b, client: c, meta, notes, style } = state;
  const { currency, locale } = meta;
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const status = effectiveStatus(state);

  const logo = style.logo
    ? el('div', { class: `inv-logo-wrap logo-shape-${style.logoShape}` }, [
        el('img', { attrs: { src: style.logo, alt: 'Business logo' } }),
      ])
    : null;

  const metaRows = [
    el('tr', {}, [el('th', { text: 'Issue Date', attrs: { scope: 'row' } }), el('td', { text: formatDate(meta.issueDate, locale) || '–' })]),
    el('tr', {}, [el('th', { text: 'Due Date', attrs: { scope: 'row' } }), el('td', { text: formatDate(meta.dueDate, locale) || '–' })]),
    meta.poNumber
      ? el('tr', {}, [el('th', { text: 'PO Number', attrs: { scope: 'row' } }), el('td', { text: meta.poNumber })])
      : null,
  ];

  const head = el('div', { class: 'inv-sheet-head' }, [
    el('div', { class: 'inv-from', attrs: { 'data-region': 'from' } }, [
      logo,
      el('div', { class: 'inv-from-text' }, [
        el('p', { class: 'inv-company', text: b.name || 'Your Company Name' }),
        p('inv-addr', b.address),
        parts('inv-contact', [b.email, b.phone, b.website]),
        p('inv-contact', b.taxId ? `Tax ID: ${b.taxId}` : ''),
      ]),
    ]),
    el('div', { class: 'inv-head-meta', attrs: { 'data-region': 'meta' } }, [
      el('span', { class: 'inv-label-tag', text: 'INVOICE' }),
      el('p', { class: 'inv-number', text: `#${meta.number || '—'}` }),
      el('span', { class: `inv-status ${status.toLowerCase()}`, text: status }),
      el('table', { class: 'inv-meta-table' }, [el('tbody', {}, metaRows)]),
    ]),
  ]);

  const billTo = el('div', { class: 'inv-bill-to', attrs: { 'data-region': 'client' } }, [
    el('p', { class: 'inv-to-cap', text: 'BILL TO' }),
    el('p', { class: 'inv-to-name', text: c.name || 'Client Name' }),
    p('inv-to-sub', c.company),
    p('inv-to-sub', c.address),
    parts('inv-to-sub', [c.email, c.phone]),
    p('inv-to-sub', c.taxId ? `Tax ID: ${c.taxId}` : ''),
  ]);

  const showTax = state.items.some((i) => i.taxRate !== null);
  const th = (text: string, cls: string) => el('th', { class: cls, text, attrs: { scope: 'col' } });
  const table = el('table', { class: 'inv-items-tbl', attrs: { 'data-region': 'items' } }, [
    el('thead', {}, [
      el('tr', {}, [
        th('#', 'tc-num'),
        th('Description', 'tc-desc'),
        th('Qty', 'tc-r'),
        th('Rate', 'tc-r'),
        showTax && th('Tax', 'tc-r tc-tax'),
        th('Amount', 'tc-r'),
      ]),
    ]),
    el(
      'tbody',
      {},
      state.items.map((item, i) => {
        const line = totals.lines[i];
        const qty = `${formatNumber(line?.qty ?? 0, locale, 3)}${item.unit ? ` ${item.unit}` : ''}`;
        return el('tr', {}, [
          el('td', { class: 'tc-num', text: String(i + 1) }),
          el('td', { class: 'tc-desc', text: item.desc || 'Item' }),
          el('td', { class: 'tc-r', text: qty }),
          el('td', { class: 'tc-r', text: money(line?.rateMinor ?? 0) }),
          showTax && el('td', { class: 'tc-r tc-tax', text: `${formatNumber(line?.taxRate ?? 0, locale, 3)}%` }),
          el('td', { class: 'tc-r', text: money(line?.amountMinor ?? 0) }),
        ]);
      }),
    ),
  ]);

  const totalsBox = el(
    'div',
    { class: 'inv-totals-mini', attrs: { 'data-region': 'totals' } },
    totalRows(state, totals).map((r) =>
      el(
        'div',
        {
          class:
            r.kind === 'grand' || r.kind === 'balance'
              ? 'itm-grand'
              : `itm-row${r.kind === 'discount' ? ' itm-disc' : ''}`,
        },
        [el('span', { text: r.label }), el('span', { text: r.value })],
      ),
    ),
  );

  const foot = el('div', { class: 'inv-sheet-foot' }, [
    el('div', { class: 'inv-foot-notes', attrs: { 'data-region': 'notes' } }, [
      p('inv-terms', notes.paymentTerms),
      p('inv-notes-text', notes.notes),
      notes.bankDetails.trim() ? el('div', { class: 'inv-bank-box', text: notes.bankDetails }) : null,
    ]),
    totalsBox,
  ]);

  const sheet = el('article', { class: 'inv-sheet', attrs: { 'aria-label': `Invoice ${meta.number}` } }, [
    head,
    el('div', { class: 'inv-rule' }),
    billTo,
    table,
    foot,
    p('inv-thankyou', notes.footer),
  ]);
  sheet.style.setProperty('--accent', style.accent);
  return sheet;
}
