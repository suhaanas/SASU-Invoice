/**
 * Renders the invoice sheet and the summary panel from state.
 * Uses textContent exclusively; line breaks come from CSS `white-space: pre-wrap`.
 */
import type { Totals } from '../core/calc';
import { formatDate } from '../core/dates';
import { formatMoney, formatNumber } from '../core/money';
import { effectiveStatus, type InvoiceState } from '../core/state';
import { byId, el, setText } from './dom';

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
  for (const tx of t.taxes) {
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

/** Render contact parts so lines only wrap between parts, never inside a phone number. */
function setParts(node: HTMLElement, parts: string[]): void {
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  node.replaceChildren(
    ...clean.flatMap((p, i) => [
      ...(i > 0 ? [' • '] : []),
      el('span', { class: 'contact-part', text: p }),
    ]),
  );
  node.hidden = clean.length === 0;
}

export function renderPreview(state: InvoiceState, totals: Totals): void {
  const { business: b, client: c, meta, notes, style } = state;
  const { currency, locale } = meta;

  // Logo
  const logoWrap = byId('invLogoWrap');
  const logo = byId<HTMLImageElement>('invLogo');
  logoWrap.hidden = !style.logo;
  logoWrap.className = `inv-logo-wrap logo-shape-${style.logoShape}`;
  if (style.logo && logo.src !== style.logo) logo.src = style.logo;
  if (!style.logo) logo.removeAttribute('src');

  byId('invCompanyName').textContent = b.name || 'Your Company Name';
  setText(byId('invCompanyAddr'), b.address);
  setParts(byId('invCompanyContact'), [b.email, b.phone, b.website]);
  setText(byId('invCompanyTax'), b.taxId ? `Tax ID: ${b.taxId}` : '');

  byId('invNumber').textContent = `#${meta.number || '—'}`;
  const status = effectiveStatus(state);
  const badge = byId('invStatusBadge');
  badge.textContent = status;
  badge.className = `inv-status ${status.toLowerCase()}`;
  byId('invIssueDate').textContent = formatDate(meta.issueDate, locale) || '–';
  byId('invDueDate').textContent = formatDate(meta.dueDate, locale) || '–';
  byId('invPORow').hidden = !meta.poNumber;
  byId('invPO').textContent = meta.poNumber;

  byId('invClientName').textContent = c.name || 'Client Name';
  setText(byId('invClientCompany'), c.company);
  setText(byId('invClientAddr'), c.address);
  setParts(byId('invClientContact'), [c.email, c.phone]);
  setText(byId('invClientTax'), c.taxId ? `Tax ID: ${c.taxId}` : '');

  // Items
  const showTax = state.items.some((i) => i.taxRate !== null);
  byId('invTaxHead').hidden = !showTax;
  const rows = state.items.map((item, i) => {
    const line = totals.lines[i];
    const qty = `${formatNumber(line?.qty ?? 0, locale, 3)}${item.unit ? ` ${item.unit}` : ''}`;
    return el('tr', {}, [
      el('td', { class: 'tc-num', text: String(i + 1) }),
      el('td', { class: 'tc-desc', text: item.desc || 'Item' }),
      el('td', { class: 'tc-r', text: qty }),
      el('td', { class: 'tc-r', text: formatMoney(line?.rateMinor ?? 0, currency, locale) }),
      showTax &&
        el('td', {
          class: 'tc-r tc-tax',
          text: `${formatNumber(line?.taxRate ?? 0, locale, 3)}%`,
        }),
      el('td', { class: 'tc-r', text: formatMoney(line?.amountMinor ?? 0, currency, locale) }),
    ]);
  });
  byId('invTbody').replaceChildren(...rows);

  // Totals
  byId('invTotals').replaceChildren(
    ...totalRows(state, totals).map((r) =>
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

  // Footer
  setText(byId('invTerms'), notes.paymentTerms);
  setText(byId('invNotes'), notes.notes);
  setText(byId('invBank'), notes.bankDetails);
  setText(byId('invFooter'), notes.footer);
}

export function renderSummary(state: InvoiceState, totals: Totals): void {
  byId('spTotals').replaceChildren(
    ...totalRows(state, totals).map((r) =>
      el(
        'div',
        {
          class:
            r.kind === 'grand' || r.kind === 'balance'
              ? 'sp-grand'
              : `sp-tr${r.kind === 'discount' ? ' sp-disc' : ''}`,
        },
        [el('span', { text: r.label }), el('span', { text: r.value })],
      ),
    ),
  );
}

/** Apply the accent colour to the page via CSSOM (allowed under CSP). */
export function applyAccent(hex: string): void {
  const n = Number.parseInt(hex.slice(1), 16);
  const rgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-rgb', rgb);
}
