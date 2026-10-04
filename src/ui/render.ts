/**
 * Editor rendering: fills the preview sheet and the summary panel from state.
 * The sheet itself is built by `buildSheet` (shared with the landing page).
 */
import type { Totals } from '../core/calc';
import type { InvoiceState } from '../core/state';
import { byId, el } from './dom';
import { buildSheet, totalRows } from './sheet';

export { totalRows, type TotalRow } from './sheet';

export function renderPreview(state: InvoiceState, totals: Totals): void {
  const built = buildSheet(state, totals);
  byId('invoicePage').replaceChildren(...built.childNodes);
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
